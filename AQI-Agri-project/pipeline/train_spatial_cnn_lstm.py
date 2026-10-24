import argparse
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import tensorflow as tf
from rasterio.warp import transform as transform_coordinates
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "pipeline" / "spatial_data"
DEFAULT_OUTPUT = ROOT / "pipeline" / "spatial_artifacts"
FEATURES = ["HCHO", "NDVI", "fire_count", "wind_u", "wind_v"]


def read_states(input_dir):
    states = {}
    for path in sorted(input_dir.glob("*_monthly_patches.npz")):
        with np.load(path, allow_pickle=False) as source:
            state = str(source["state"].item())
            images = source["images"].astype(np.float32)
            month_ids = source["month_ids"].astype(np.int32)
            crs = str(source["crs"].item())
            transform = rasterio.Affine(*source["transform"].astype(float).tolist())
            feature_names = source["feature_names"].tolist()
        if feature_names != FEATURES:
            raise ValueError(f"Unexpected feature order in {path}: {feature_names}")
        if images.shape[0] != len(month_ids) or images.shape[-1] != len(FEATURES):
            raise ValueError(f"Image array shape does not match metadata in {path}.")
        states[state] = {"images": images, "month_ids": month_ids, "crs": crs, "transform": transform}
    if len(states) != 3:
        raise ValueError(f"Expected 3 state raster files in {input_dir}; found {sorted(states)}")
    return states


def candidate_patches(images, patch_size, stride, minimum_coverage, max_patches):
    _, height, width, _ = images.shape
    candidates = []
    hcho = images[..., 0]
    for top in range(0, height - patch_size + 1, stride):
        for left in range(0, width - patch_size + 1, stride):
            tile = hcho[:, top : top + patch_size, left : left + patch_size]
            coverage = float(np.isfinite(tile).mean())
            if coverage >= minimum_coverage:
                candidates.append((coverage, top, left))
    candidates.sort(reverse=True)
    return [(top, left, coverage) for coverage, top, left in candidates[:max_patches]]


def training_scaler(states, train_end_index):
    totals = np.zeros(len(FEATURES), dtype=np.float64)
    squares = np.zeros(len(FEATURES), dtype=np.float64)
    counts = np.zeros(len(FEATURES), dtype=np.int64)
    for state_data in states.values():
        training_images = state_data["images"][:train_end_index]
        for feature_index in range(len(FEATURES)):
            values = training_images[..., feature_index]
            values = values[np.isfinite(values)]
            totals[feature_index] += values.sum(dtype=np.float64)
            squares[feature_index] += np.square(values, dtype=np.float64).sum(dtype=np.float64)
            counts[feature_index] += len(values)
    if np.any(counts == 0):
        raise ValueError("At least one feature has no valid training pixels.")
    means = totals / counts
    variances = np.maximum(squares / counts - means**2, 1e-12)
    scales = np.sqrt(variances)
    for state_data in states.values():
        images = state_data["images"].copy()
        for feature_index in range(len(FEATURES)):
            band = images[..., feature_index]
            band[~np.isfinite(band)] = means[feature_index]
            images[..., feature_index] = (band - means[feature_index]) / scales[feature_index]
        state_data["scaled"] = images.astype(np.float32)
    return means, scales


def build_samples(states, month_ids, thresholds, patch_map, patch_size, sequence_months, train_end, validation_end):
    samples = {"train": [], "validation": [], "test": []}
    patch_counts = {}
    for state, state_data in states.items():
        raw = state_data["images"]
        patch_list = patch_map[state]
        patch_counts[state] = len(patch_list)
        state_samples = []
        for patch_index, (top, left, coverage) in enumerate(patch_list):
            hcho_tile = raw[:, top : top + patch_size, left : left + patch_size, 0]
            target_values = np.full(len(month_ids), np.nan, dtype=np.float32)
            for target_index in range(sequence_months, len(month_ids)):
                current_id = month_ids[target_index]
                prior_ids = month_ids[target_index - sequence_months : target_index]
                if not np.array_equal(prior_ids, np.arange(current_id - sequence_months, current_id)):
                    continue
                target_tile = hcho_tile[target_index]
                if np.isfinite(target_tile).mean() < 0.4:
                    continue
                target_values[target_index] = float(np.nanmean(target_tile))
            for target_index, target_hcho in enumerate(target_values):
                if not np.isfinite(target_hcho):
                    continue
                sample = {
                    "state": state,
                    "patch_index": patch_index,
                    "top": top,
                    "left": left,
                    "coverage": coverage,
                    "target_index": target_index,
                    "target_month_id": int(month_ids[target_index]),
                    "label": int(target_hcho >= thresholds[state]),
                    "actual_hcho": float(target_hcho),
                }
                state_samples.append(sample)
        for sample in state_samples:
            target_index = sample["target_index"]
            if target_index < train_end:
                split = "train"
            elif target_index < validation_end:
                split = "validation"
            else:
                split = "test"
            samples[split].append(sample)
    return samples, patch_counts


def make_dataset(samples, states, sequence_months, patch_size, batch_size, shuffle=False):
    signature = (
        tf.TensorSpec((sequence_months, patch_size, patch_size, len(FEATURES)), tf.float32),
        tf.TensorSpec((), tf.float32),
    )

    def generate():
        order = np.arange(len(samples))
        if shuffle:
            np.random.shuffle(order)
        for index in order:
            sample = samples[int(index)]
            start = sample["target_index"] - sequence_months
            state_images = states[sample["state"]]["scaled"]
            sequence = state_images[
                start : sample["target_index"],
                sample["top"] : sample["top"] + patch_size,
                sample["left"] : sample["left"] + patch_size,
                :,
            ]
            yield sequence, np.float32(sample["label"])

    dataset = tf.data.Dataset.from_generator(generate, output_signature=signature)
    if shuffle and samples:
        dataset = dataset.shuffle(min(64, len(samples)), seed=42, reshuffle_each_iteration=True)
    return dataset.batch(batch_size).prefetch(1)


def coordinates_for_patch(state_data, top, left, patch_size):
    transform = state_data["transform"]
    x, y = transform * (left + patch_size / 2, top + patch_size / 2)
    longitude, latitude = transform_coordinates(state_data["crs"], "EPSG:4326", [x], [y])
    return float(longitude[0]), float(latitude[0])


def main():
    parser = argparse.ArgumentParser(description="Train a spatial Conv2D-LSTM on GEE image patches.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--patch-size", type=int, default=32)
    parser.add_argument("--stride", type=int, default=16)
    parser.add_argument("--max-patches-per-state", type=int, default=12)
    parser.add_argument("--minimum-coverage", type=float, default=0.4)
    parser.add_argument("--sequence-months", type=int, default=12)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args()
    if args.patch_size < 8 or args.stride < 1 or args.sequence_months < 2:
        parser.error("Patch size must be >= 8, stride >= 1, and sequence months >= 2.")

    random.seed(42)
    np.random.seed(42)
    tf.keras.utils.set_random_seed(42)
    states = read_states(args.input_dir)
    month_ids = next(iter(states.values()))["month_ids"]
    if any(not np.array_equal(state_data["month_ids"], month_ids) for state_data in states.values()):
        raise ValueError("All states must have the same monthly dates.")
    if len(month_ids) < args.sequence_months + 10:
        raise ValueError("Not enough monthly observations for sequence training and evaluation.")

    train_end = max(1, int(len(month_ids) * 0.70))
    validation_end = max(train_end + 1, int(len(month_ids) * 0.85))
    if validation_end >= len(month_ids):
        raise ValueError("The chronological split leaves no test period.")
    means, scales = training_scaler(states, train_end)

    patch_map = {
        state: candidate_patches(
            state_data["images"], args.patch_size, args.stride, args.minimum_coverage, args.max_patches_per_state
        )
        for state, state_data in states.items()
    }
    if any(not patches for patches in patch_map.values()):
        missing = [state for state, patches in patch_map.items() if not patches]
        raise ValueError(f"No usable {args.patch_size}x{args.patch_size} patches for {missing}.")

    thresholds = {}
    for state, state_data in states.items():
        training_targets = []
        for top, left, _ in patch_map[state]:
            hcho_tile = state_data["images"][:, top : top + args.patch_size, left : left + args.patch_size, 0]
            for target_index in range(args.sequence_months, train_end):
                target_tile = hcho_tile[target_index]
                if np.isfinite(target_tile).mean() >= 0.4:
                    training_targets.append(float(np.nanmean(target_tile)))
        if not training_targets:
            raise ValueError(f"No valid training HCHO patch targets for {state}.")
        thresholds[state] = float(np.quantile(training_targets, 0.90))

    splits, patch_counts = build_samples(
        states, month_ids, thresholds, patch_map, args.patch_size, args.sequence_months, train_end, validation_end
    )
    if any(not splits[name] for name in ("train", "validation", "test")):
        raise ValueError(f"Empty chronological split: { {name: len(items) for name, items in splits.items()} }")
    train_labels = np.asarray([sample["label"] for sample in splits["train"]], dtype=np.int32)
    class_counts = np.bincount(train_labels, minlength=2)
    if np.count_nonzero(class_counts) < 2:
        raise ValueError("Training data contains only one label class; adjust scope or collect more data.")

    inputs = tf.keras.layers.Input(shape=(args.sequence_months, args.patch_size, args.patch_size, len(FEATURES)))
    features = tf.keras.layers.TimeDistributed(
        tf.keras.layers.Conv2D(16, 3, strides=2, padding="same", activation="relu")
    )(inputs)
    features = tf.keras.layers.TimeDistributed(
        tf.keras.layers.Conv2D(24, 3, strides=2, padding="same", activation="relu")
    )(features)
    features = tf.keras.layers.TimeDistributed(tf.keras.layers.GlobalAveragePooling2D())(features)
    features = tf.keras.layers.LSTM(32)(features)
    features = tf.keras.layers.Dense(16, activation="relu")(features)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(features)
    model = tf.keras.Model(inputs, outputs)
    model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy", tf.keras.metrics.AUC(name="auc")])
    class_weight = {
        label: len(train_labels) / (2 * count)
        for label, count in enumerate(class_counts)
        if count > 0
    }
    model.fit(
        make_dataset(splits["train"], states, args.sequence_months, args.patch_size, args.batch_size, shuffle=True),
        validation_data=make_dataset(
            splits["validation"], states, args.sequence_months, args.patch_size, args.batch_size
        ),
        epochs=args.epochs,
        class_weight=class_weight,
        callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=10, restore_best_weights=True)],
        verbose=2,
    )

    train_dataset = make_dataset(splits["train"], states, args.sequence_months, args.patch_size, args.batch_size)
    train_probabilities = model.predict(train_dataset, verbose=0).ravel()
    train_predictions = (train_probabilities >= 0.5).astype(np.int32)
    train_labels = np.asarray([sample["label"] for sample in splits["train"]], dtype=np.int32)
    test_dataset = make_dataset(splits["test"], states, args.sequence_months, args.patch_size, args.batch_size)
    probabilities = model.predict(test_dataset, verbose=0).ravel()
    test_labels = np.asarray([sample["label"] for sample in splits["test"]], dtype=np.int32)
    predictions = (probabilities >= 0.5).astype(np.int32)
    metrics = {
        "states": sorted(states),
        "input_months": len(month_ids),
        "sequence_months": args.sequence_months,
        "patch_size": args.patch_size,
        "patch_stride": args.stride,
        "patches_by_state": patch_counts,
        "training_sequences": len(splits["train"]),
        "validation_sequences": len(splits["validation"]),
        "test_sequences": len(splits["test"]),
        "training_label_counts": {str(key): int(value) for key, value in enumerate(class_counts)},
        "training_accuracy": float(accuracy_score(train_labels, train_predictions)),
        "test_accuracy": float(accuracy_score(test_labels, predictions)),
        "test_precision": float(precision_score(test_labels, predictions, zero_division=0)),
        "test_recall": float(recall_score(test_labels, predictions, zero_division=0)),
        "test_roc_auc": float(roc_auc_score(test_labels, probabilities))
        if len(np.unique(test_labels)) == 2
        else None,
        "label_rule": "Patch mean HCHO >= state-specific training-period 90th percentile",
        "thresholds_by_state": thresholds,
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    model.save(args.output_dir / "spatial_cnn_lstm.keras")
    np.savez(args.output_dir / "feature_scaler.npz", mean=means, scale=scales, features=np.asarray(FEATURES))
    (args.output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    test_output = []
    for sample, probability, prediction in zip(splits["test"], probabilities, predictions):
        longitude, latitude = coordinates_for_patch(
            states[sample["state"]], sample["top"], sample["left"], args.patch_size
        )
        year, month_index = divmod(sample["target_month_id"], 12)
        test_output.append(
            {
                "state": sample["state"],
                "latitude": latitude,
                "longitude": longitude,
                "year": year,
                "month": month_index + 1,
                "actual_hotspot": sample["label"],
                "predicted_probability": float(probability),
                "predicted_hotspot": int(prediction),
            }
        )
    pd.DataFrame(test_output).to_csv(args.output_dir / "test_predictions.csv", index=False)
    dashboard_test_predictions = ROOT / "frontend" / "public" / "data" / "spatial_cnn_lstm_test_predictions.csv"
    dashboard_test_predictions.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(test_output).to_csv(dashboard_test_predictions, index=False)

    next_rows = []
    for state, state_data in states.items():
        for patch_index, (top, left, _) in enumerate(patch_map[state]):
            sequence = state_data["scaled"][-args.sequence_months :, top : top + args.patch_size, left : left + args.patch_size]
            probability = float(model.predict(sequence[None, ...], verbose=0).ravel()[0])
            longitude, latitude = coordinates_for_patch(state_data, top, left, args.patch_size)
            next_month_id = int(month_ids[-1] + 1)
            year, month_index = divmod(next_month_id, 12)
            next_rows.append(
                {
                    "state": state,
                    "patch_index": patch_index,
                    "latitude": latitude,
                    "longitude": longitude,
                    "year": year,
                    "month": month_index + 1,
                    "predicted_hotspot": int(probability >= 0.5),
                    "predicted_probability": probability,
                }
            )
    next_predictions = pd.DataFrame(next_rows)
    next_predictions.to_csv(args.output_dir / "next_month_predictions.csv", index=False)
    dashboard_predictions = ROOT / "frontend" / "public" / "data" / "spatial_cnn_lstm_predictions.csv"
    dashboard_predictions.parent.mkdir(parents=True, exist_ok=True)
    next_predictions.to_csv(dashboard_predictions, index=False)
    print(json.dumps(metrics, indent=2))
    print(f"Spatial CNN-LSTM artifacts saved under {args.output_dir}")
    print(f"Dashboard test predictions saved to {dashboard_test_predictions}")
    print(f"Dashboard predictions saved to {dashboard_predictions}")


if __name__ == "__main__":
    main()