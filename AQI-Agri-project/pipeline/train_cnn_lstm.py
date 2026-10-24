import argparse
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "frontend" / "public" / "data" / "gee_monthly_state_data.csv"
DEFAULT_OUTPUT = ROOT / "pipeline" / "artifacts"
FEATURES = ["HCHO", "fire_count", "wind_u", "wind_v", "wind_speed", "NDVI", "NDVI_observed"]
SEQUENCE_MONTHS = 12


def make_samples(data: pd.DataFrame, sequence_months: int):
    samples = []
    for state, group in data.groupby("state"):
        group = group.sort_values("month_id").reset_index(drop=True)
        values = group[FEATURES].to_numpy(dtype=np.float32)
        for target_index in range(sequence_months, len(group)):
            window = group.iloc[target_index - sequence_months : target_index]
            target = group.iloc[target_index]
            if not np.isfinite(target["HCHO"]):
                continue
            expected_months = np.arange(target["month_id"] - sequence_months, target["month_id"])
            if not np.array_equal(window["month_id"].to_numpy(), expected_months):
                continue
            if not np.isfinite(values[target_index - sequence_months : target_index]).all():
                continue
            samples.append(
                {
                    "state": state,
                    "target_month_id": int(target["month_id"]),
                    "target_year": int(target["year"]),
                    "target_month": int(target["month"]),
                    "target_hcho": float(target["HCHO"]),
                    "x": values[target_index - sequence_months : target_index],
                }
            )
    return samples


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a temporal Conv1D-LSTM HCHO hotspot model.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--sequence-months", type=int, default=SEQUENCE_MONTHS)
    parser.add_argument("--epochs", type=int, default=100)
    args = parser.parse_args()
    if args.sequence_months < 2:
        parser.error("--sequence-months must be at least 2.")

    random.seed(42)
    np.random.seed(42)
    tf.keras.utils.set_random_seed(42)

    data = pd.read_csv(args.input)
    required = {"state", "year", "month", *FEATURES}
    missing = required.difference(data.columns)
    if missing:
        raise ValueError(f"Input is missing columns: {sorted(missing)}")
    data["month_id"] = data["year"].astype(int) * 12 + data["month"].astype(int) - 1
    data = data.sort_values(["state", "month_id"]).copy()
    data[FEATURES] = data.groupby("state")[FEATURES].ffill()
    months = np.sort(data["month_id"].unique())
    if len(months) < args.sequence_months + 10:
        raise ValueError("Not enough monthly history for sequences and chronological evaluation.")

    train_end = months[max(1, int(len(months) * 0.70)) - 1]
    validation_end = months[max(2, int(len(months) * 0.85)) - 1]
    thresholds = {}
    for state, group in data[data["month_id"] <= train_end].groupby("state"):
        valid_hcho = group["HCHO"].dropna()
        if valid_hcho.empty:
            raise ValueError(f"No training HCHO values for {state}.")
        thresholds[state] = float(valid_hcho.quantile(0.90))

    samples = make_samples(data, args.sequence_months)
    for sample in samples:
        sample["label"] = int(sample["target_hcho"] >= thresholds[sample["state"]])
    train = [sample for sample in samples if sample["target_month_id"] <= train_end]
    validation = [sample for sample in samples if train_end < sample["target_month_id"] <= validation_end]
    test = [sample for sample in samples if sample["target_month_id"] > validation_end]
    if not train or not validation or not test:
        raise ValueError("Chronological split produced an empty train, validation, or test set.")
    if len({sample["label"] for sample in train}) < 2:
        raise ValueError("Training split contains only one class; collect more history or adjust the threshold.")

    scaler = StandardScaler()
    train_x_raw = np.stack([sample["x"] for sample in train])
    scaler.fit(train_x_raw.reshape(-1, len(FEATURES)))

    def scaled(sampleset):
        raw = np.stack([sample["x"] for sample in sampleset])
        return scaler.transform(raw.reshape(-1, len(FEATURES))).reshape(raw.shape).astype(np.float32)

    train_x = scaled(train)
    validation_x = scaled(validation)
    test_x = scaled(test)
    train_y = np.array([sample["label"] for sample in train], dtype=np.float32)
    validation_y = np.array([sample["label"] for sample in validation], dtype=np.float32)
    test_y = np.array([sample["label"] for sample in test], dtype=np.int32)

    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(args.sequence_months, len(FEATURES))),
            tf.keras.layers.Conv1D(32, kernel_size=3, padding="causal", activation="relu"),
            tf.keras.layers.LSTM(32),
            tf.keras.layers.Dense(16, activation="relu"),
            tf.keras.layers.Dense(1, activation="sigmoid"),
        ]
    )
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy", tf.keras.metrics.AUC(name="auc")])
    class_counts = np.bincount(train_y.astype(int), minlength=2)
    class_weight = {
        label: len(train_y) / (2 * count)
        for label, count in enumerate(class_counts)
        if count > 0
    }
    model.fit(
        train_x,
        train_y,
        validation_data=(validation_x, validation_y),
        epochs=args.epochs,
        batch_size=16,
        class_weight=class_weight,
        callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=12, restore_best_weights=True)],
        verbose=2,
    )

    probabilities = model.predict(test_x, verbose=0).ravel()
    predictions = (probabilities >= 0.5).astype(int)
    metrics = {
        "input_records": int(len(data)),
        "sequence_months": args.sequence_months,
        "training_sequences": len(train),
        "validation_sequences": len(validation),
        "test_sequences": len(test),
        "training_label_counts": {str(key): int(value) for key, value in enumerate(class_counts)},
        "test_accuracy": float(accuracy_score(test_y, predictions)),
        "test_precision": float(precision_score(test_y, predictions, zero_division=0)),
        "test_recall": float(recall_score(test_y, predictions, zero_division=0)),
        "test_roc_auc": float(roc_auc_score(test_y, probabilities)) if len(np.unique(test_y)) == 2 else None,
        "hotspot_rule": "HCHO >= state-specific 90th percentile of training-period HCHO",
        "thresholds_by_state": thresholds,
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    model.save(args.output_dir / "hcho_cnn_lstm.keras")
    np.savez(args.output_dir / "feature_scaler.npz", mean=scaler.mean_, scale=scaler.scale_)
    (args.output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    test_output = pd.DataFrame(
        [
            {
                "state": sample["state"],
                "year": sample["target_year"],
                "month": sample["target_month"],
                "actual_hotspot": sample["label"],
                "predicted_probability": float(probability),
                "predicted_hotspot": int(prediction),
            }
            for sample, probability, prediction in zip(test, probabilities, predictions)
        ]
    )
    test_output.to_csv(args.output_dir / "test_predictions.csv", index=False)

    next_month_rows = []
    for state, group in data.groupby("state"):
        group = group.sort_values("month_id").tail(args.sequence_months)
        expected = np.arange(group["month_id"].iloc[-1] - args.sequence_months + 1, group["month_id"].iloc[-1] + 1)
        if len(group) != args.sequence_months or not np.array_equal(group["month_id"].to_numpy(), expected):
            continue
        sequence = group[FEATURES].to_numpy(dtype=np.float32)
        if not np.isfinite(sequence).all():
            continue
        scaled_sequence = scaler.transform(sequence).reshape(1, args.sequence_months, len(FEATURES))
        probability = float(model.predict(scaled_sequence, verbose=0).ravel()[0])
        next_month_id = int(group["month_id"].iloc[-1] + 1)
        next_year, month_index = divmod(next_month_id, 12)
        next_month_rows.append(
            {
                "state": state,
                "year": next_year,
                "month": month_index + 1,
                "predicted_hotspot": int(probability >= 0.5),
                "predicted_probability": probability,
            }
        )
    pd.DataFrame(next_month_rows).to_csv(args.output_dir / "next_month_predictions.csv", index=False)
    print(json.dumps(metrics, indent=2))
    print(f"Artifacts saved under {args.output_dir}")


if __name__ == "__main__":
    main()