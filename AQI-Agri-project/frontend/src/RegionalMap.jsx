import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getStatePrediction } from "./modelPredictions";

const GEOJSON_PATH = "/data/india_states.geojson";
const TRACKED_STATES = ["Punjab", "Haryana", "Uttar Pradesh"];

const RISK_COLOURS = {
  high: "#c43d3d",
  moderate: "#e58b24",
  low: "#21966b",
  none: "#7b8794",
};

function getRiskFromPrediction(pred) {
  if (!pred) return null;
  const hotspot = Number(pred.predicted_hotspot);
  const prob = Number(pred.predicted_probability);
  if (hotspot === 1) {
    return prob >= 0.7 ? "high" : "moderate";
  }
  return "low";
}

function getRiskLabel(risk) {
  if (risk === "high") return "High potential risk";
  if (risk === "moderate") return "Moderate potential risk";
  if (risk === "low") return "Low potential risk";
  return "Insufficient data";
}

function getPatchColour(prediction) {
  if (Number(prediction.predicted_hotspot) === 1) {
    return Number(prediction.predicted_probability) >= 0.7
      ? RISK_COLOURS.high
      : RISK_COLOURS.moderate;
  }
  return RISK_COLOURS.low;
}

function formatNum(val, digits) {
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(digits) : "N/A";
}

// Resets map view when bounds change
function FitBounds({ geojsonData }) {
  const map = useMap();
  useEffect(() => {
    if (!geojsonData) return;
    try {
      const layer = L.geoJSON(geojsonData);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch {
      // ignore
    }
  }, [geojsonData, map]);
  return null;
}

export default function RegionalMap({
  data = [],
  predictionData = [],
  selectedYear,
  selectedMonth,
  onSelectState,
}) {
  const [geojson, setGeojson] = useState(null);
  const geojsonLayerRef = useRef(null);

  useEffect(() => {
    fetch(GEOJSON_PATH)
      .then((r) => r.json())
      .then(setGeojson)
      .catch(() => setGeojson(null));
  }, []);

  // Build per-state lookup for the selected period
  const stateInfo = useMemo(() => {
    const map = {};
    TRACKED_STATES.forEach((state) => {
      const envRow =
        data.find(
          (r) =>
            r.state === state &&
            Number(r.year) === Number(selectedYear) &&
            Number(r.month) === Number(selectedMonth)
        ) || null;

      const pred = getStatePrediction(
        predictionData,
        state,
        selectedYear,
        selectedMonth
      );

      const historicalHotspot = Number(envRow?.HCHO_hotspot);
      const historicalRisk = Number.isFinite(historicalHotspot)
        ? historicalHotspot === 1
          ? "moderate"
          : "low"
        : null;
      const risk = getRiskFromPrediction(pred) || historicalRisk;
      map[state] = {
        envRow,
        pred,
        risk,
        riskSource: pred ? "model" : historicalRisk ? "historical" : null,
      };
    });
    return map;
  }, [data, predictionData, selectedYear, selectedMonth]);

  const visiblePatchPredictions = useMemo(
    () =>
      predictionData.filter(
        (prediction) =>
          Number(prediction.year) === Number(selectedYear) &&
          Number(prediction.month) === Number(selectedMonth) &&
          Number.isFinite(Number(prediction.latitude)) &&
          Number.isFinite(Number(prediction.longitude))
      ),
    [predictionData, selectedYear, selectedMonth]
  );

  // Re-style polygons whenever stateInfo changes
  useEffect(() => {
    if (!geojsonLayerRef.current) return;
    geojsonLayerRef.current.eachLayer((layer) => {
      const name = layer.feature?.properties?.ST_NM;
      const info = stateInfo[name];
      if (info) {
        const colour = info.risk ? RISK_COLOURS[info.risk] : RISK_COLOURS.none;
        layer.setStyle({
          fillColor: colour,
          fillOpacity: 0.72,
          color: "#fff",
          weight: 2,
        });
      }
    });
  }, [stateInfo]);

  const styleFeature = (feature) => {
    const name = feature?.properties?.ST_NM;
    const info = stateInfo[name];
    if (!info) {
      return {
        fillColor: "#d1d9e0",
        fillOpacity: 0.25,
        color: "#b0bec5",
        weight: 0.8,
      };
    }
    const colour = info.risk ? RISK_COLOURS[info.risk] : RISK_COLOURS.none;
    return {
      fillColor: colour,
      fillOpacity: 0.72,
      color: "#fff",
      weight: 2,
    };
  };

  const onEachFeature = (feature, layer) => {
    const name = feature?.properties?.ST_NM;
    const info = stateInfo[name];

    if (!info) {
      layer.on({
        mouseover: (e) => e.target.setStyle({ fillOpacity: 0.4 }),
        mouseout: (e) => e.target.setStyle({ fillOpacity: 0.25 }),
      });
      return;
    }

    const { envRow, pred, risk, riskSource } = info;
    const riskLabel = getRiskLabel(risk);
    const probText =
      pred && pred.predicted_probability !== undefined && pred.predicted_probability !== ""
        ? formatNum(pred.predicted_probability, 3)
        : "N/A";

    const popupHtml = `
      <div class="map-popup">
        <h3>${name}</h3>
        <p><strong>Period:</strong> ${selectedMonth}/${selectedYear}</p>
        <p><strong>${riskSource === "model" ? "Model risk" : "Observed HCHO risk"}:</strong> ${riskLabel}</p>
        ${pred ? `<p><strong>Mean patch probability:</strong> ${probText}</p><p><strong>High-risk patches:</strong> ${pred.hotspot_patch_count}/${pred.patch_count}</p>` : ""}
        ${
          envRow
            ? `<p><strong>HCHO:</strong> ${formatNum(envRow.HCHO, 6)}</p>
               <p><strong>NDVI:</strong> ${formatNum(envRow.NDVI, 3)}</p>
               <p><strong>Fire count:</strong> ${Number.isFinite(Number(envRow.fire_count)) ? Number(envRow.fire_count).toLocaleString() : "N/A"}</p>
               <p><strong>Wind speed:</strong> ${formatNum(envRow.wind_speed, 3)}</p>
               <p><strong>HCHO hotspot:</strong> ${envRow.HCHO_hotspot === 1 ? "Present" : "Not present"}</p>`
            : `<p><em>No environmental record for this period.</em></p>`
        }
        <p class="popup-disclaimer">Preliminary state-level output. Not a verified crop-damage assessment.</p>
      </div>`;

    layer.bindPopup(popupHtml);

    layer.on({
      mouseover: (e) => {
        e.target.setStyle({ fillOpacity: 0.9, weight: 3 });
        e.target.openPopup();
      },
      mouseout: (e) => {
        e.target.setStyle({
          fillOpacity: 0.72,
          weight: 2,
          color: "#fff",
        });
        e.target.closePopup();
      },
      click: () => {
        if (onSelectState && TRACKED_STATES.includes(name)) {
          onSelectState(name);
        }
      },
    });
  };

  const onGeoJSONReady = (layer) => {
    geojsonLayerRef.current = layer;
  };

  if (!geojson) {
    return (
      <div
        className="leaflet-map"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#65748a", fontSize: 13 }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <MapContainer
      className="leaflet-map"
      center={[22.5, 80]}
      zoom={4}
      scrollWheelZoom={false}
      style={{ height: 420, width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        opacity={0.35}
      />
      <GeoJSON
        key={`${selectedYear}-${selectedMonth}`}
        data={geojson}
        style={styleFeature}
        onEachFeature={onEachFeature}
        ref={onGeoJSONReady}
      />
      {visiblePatchPredictions.map((prediction) => (
        <CircleMarker
          key={`${prediction.state}-${prediction.year}-${prediction.month}-${prediction.patch_index ?? prediction.latitude}-${prediction.longitude}`}
          center={[Number(prediction.latitude), Number(prediction.longitude)]}
          radius={7}
          pathOptions={{
            color: "#ffffff",
            weight: 1.5,
            fillColor: getPatchColour(prediction),
            fillOpacity: 0.95,
          }}
        >
          <Popup>
            <strong>{prediction.state} model patch</strong>
            <br />
            {prediction.month}/{prediction.year}
            <br />
            Probability: {formatNum(prediction.predicted_probability, 3)}
            <br />
            {Number(prediction.predicted_hotspot) === 1 ? "High-HCHO patch" : "No high-HCHO signal"}
          </Popup>
        </CircleMarker>
      ))}
      <FitBounds geojsonData={geojson} />
    </MapContainer>
  );
}
