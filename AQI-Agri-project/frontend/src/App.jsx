import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  LayoutDashboard,
  Map,
  ChartNoAxesCombined,
  Activity,
  Leaf,
  Wind,
  Flame,
  AlertTriangle,
  Menu,
  RefreshCw,
  Telescope,
} from "lucide-react";

import "./App.css";
import RegionalMap from "./RegionalMap";
import { getStatePrediction } from "./modelPredictions";

const CSV_PATH = "/data/agricultural_risk_master_clean.csv";
const PREDICTION_PATHS = [
  "/data/spatial_cnn_lstm_test_predictions.csv",
  "/data/spatial_cnn_lstm_predictions.csv",
];

const STATES = ["Punjab", "Haryana", "Uttar Pradesh"];

// Major cities mapped to their state (dataset covers only these 3 states)
const CITY_TO_STATE = {
  // Punjab
  "amritsar": "Punjab", "ludhiana": "Punjab", "jalandhar": "Punjab",
  "patiala": "Punjab", "bathinda": "Punjab", "mohali": "Punjab",
  "pathankot": "Punjab", "hoshiarpur": "Punjab", "gurdaspur": "Punjab",
  "firozpur": "Punjab", "moga": "Punjab", "barnala": "Punjab",
  "chandigarh": "Punjab", "ropar": "Punjab", "fatehgarh sahib": "Punjab",
  // Haryana
  "gurugram": "Haryana", "faridabad": "Haryana", "panipat": "Haryana",
  "ambala": "Haryana", "yamunanagar": "Haryana", "rohtak": "Haryana",
  "hisar": "Haryana", "karnal": "Haryana", "sonipat": "Haryana",
  "panchkula": "Haryana", "bhiwani": "Haryana", "sirsa": "Haryana",
  "kurukshetra": "Haryana", "rewari": "Haryana", "jhajjar": "Haryana",
  "gurgaon": "Haryana", "palwal": "Haryana", "nuh": "Haryana",
  // Uttar Pradesh
  "lucknow": "Uttar Pradesh", "kanpur": "Uttar Pradesh", "agra": "Uttar Pradesh",
  "varanasi": "Uttar Pradesh", "meerut": "Uttar Pradesh", "allahabad": "Uttar Pradesh",
  "prayagraj": "Uttar Pradesh", "ghaziabad": "Uttar Pradesh", "noida": "Uttar Pradesh",
  "bareilly": "Uttar Pradesh", "aligarh": "Uttar Pradesh", "moradabad": "Uttar Pradesh",
  "saharanpur": "Uttar Pradesh", "gorakhpur": "Uttar Pradesh", "mathura": "Uttar Pradesh",
  "firozabad": "Uttar Pradesh", "muzaffarnagar": "Uttar Pradesh", "jhansi": "Uttar Pradesh",
  "shahjahanpur": "Uttar Pradesh", "rampur": "Uttar Pradesh", "bulandshahr": "Uttar Pradesh",
  "hapur": "Uttar Pradesh", "etawah": "Uttar Pradesh", "mirzapur": "Uttar Pradesh",
};

const resolveCity = (input) => {
  const key = input.trim().toLowerCase();
  if (CITY_TO_STATE[key]) return { state: CITY_TO_STATE[key], matched: true };
  // Partial match
  const partial = Object.keys(CITY_TO_STATE).find((c) => c.includes(key) || key.includes(c));
  if (partial) return { state: CITY_TO_STATE[partial], matched: true };
  // Check if input is a state name directly
  const stateMatch = STATES.find((s) => s.toLowerCase() === key);
  if (stateMatch) return { state: stateMatch, matched: true };
  return { state: null, matched: false };
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const NAV_ITEMS = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Map View", icon: Map },
  { name: "Monthly Analysis", icon: ChartNoAxesCombined },
  { name: "Risk Indicators", icon: Activity },
  { name: "Future Predict", icon: Telescope },
];

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value, digits = 3) => {
  if (value === null || value === undefined || value === "") return "N/A";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
};

const getModelRisk = (row) => {
  const value = row?.risk_category || row?.predicted_risk || row?.category || row?.prediction;
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "High potential risk";
  if (normalized.includes("moderate") || normalized.includes("medium")) return "Moderate potential risk";
  if (normalized.includes("low")) return "Low potential risk";
  const hotspot = Number(row?.predicted_hotspot);
  if (hotspot === 1) {
    return Number(row?.predicted_probability) >= 0.7
      ? "High potential risk"
      : "Moderate potential risk";
  }
  if (hotspot === 0) return "Low potential risk";
  return "Insufficient data";
};

const getRiskStatus = (row) => {
  if (!row) {
    return {
      label: "Insufficient data",
      description: "No matching observation is available for this selection.",
      className: "risk-neutral",
    };
  }

  const hotspot = numberValue(row.HCHO_hotspot);

  if (hotspot === 1) {
    return {
      label: "Potential stress detected",
      description:
        "The HCHO hotspot indicator is present. This is a satellite-derived proxy and does not confirm crop damage.",
      className: "risk-high",
    };
  }

  return {
    label: "No potential stress signal detected",
    description:
      "The HCHO hotspot indicator is not present in this observation. This does not guarantee that crops are unaffected.",
    className: "risk-low",
  };
};

function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [predictionData, setPredictionData] = useState([]);
  const [predictionStatus, setPredictionStatus] = useState("unavailable");
  const [activePage, setActivePage] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [selectedState, setSelectedState] = useState("Punjab");
  const [selectedYear, setSelectedYear] = useState("2026");
  const [selectedMonth, setSelectedMonth] = useState("9");

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(CSV_PATH);

        if (!response.ok) {
          throw new Error(
            `Could not load the CSV file. Server returned ${response.status}.`
          );
        }

        const csvText = await response.text();

        const parsed = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
        });

        if (parsed.errors?.length) {
          console.warn("CSV parsing warnings:", parsed.errors);
        }

        const cleanedRows = parsed.data
          .filter((row) => row.state && row.year && row.month)
          .map((row) => ({
            ...row,
            year: numberValue(row.year),
            month: numberValue(row.month),
            HCHO: numberValue(row.HCHO),
            fire_count: numberValue(row.fire_count),
            wind_u: numberValue(row.wind_u),
            wind_v: numberValue(row.wind_v),
            wind_speed: numberValue(row.wind_speed),
            NDVI:
              row.NDVI === "" || row.NDVI === null || row.NDVI === undefined
                ? null
                : numberValue(row.NDVI),
            NDVI_observed: numberValue(row.NDVI_observed),
            HCHO_anomaly: numberValue(row.HCHO_anomaly),
            HCHO_hotspot: numberValue(row.HCHO_hotspot),
          }));

        if (!cancelled) {
          setData(cleanedRows);

          const availableYears = [
            ...new Set(cleanedRows.map((row) => row.year)),
          ].sort((a, b) => a - b);

          setSelectedYear((currentYear) =>
            availableYears.length && !availableYears.includes(Number(currentYear))
              ? String(availableYears[availableYears.length - 1])
              : currentYear
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "An error occurred while loading the data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPredictions = async () => {
      try {
        const predictionFiles = await Promise.all(
          PREDICTION_PATHS.map(async (path) => {
            const response = await fetch(path);
            if (!response.ok) return [];
            const csvText = await response.text();
            return Papa.parse(csvText, {
              header: true,
              skipEmptyLines: true,
              dynamicTyping: true,
            }).data;
          })
        );

        if (!cancelled) {
          const predictions = predictionFiles.flat().filter(
            (row) =>
              row.state &&
              Number.isFinite(Number(row.year)) &&
              Number.isFinite(Number(row.month))
          );
          setPredictionData(predictions);
          setPredictionStatus(predictions.length ? "available" : "unavailable");
          const latestPrediction = predictions.reduce((latest, row) => {
            if (
              !latest ||
              Number(row.year) > Number(latest.year) ||
              (Number(row.year) === Number(latest.year) &&
                Number(row.month) > Number(latest.month))
            ) {
              return row;
            }
            return latest;
          }, null);
          if (latestPrediction) {
            setSelectedYear(String(latestPrediction.year));
            setSelectedMonth(String(latestPrediction.month));
          }
        }
      } catch {
        if (!cancelled) {
          setPredictionData([]);
          setPredictionStatus("unavailable");
        }
      }
    };

    loadPredictions();

    return () => {
      cancelled = true;
    };
  }, []);

  const years = useMemo(() => {
    return [...new Set(data.map((row) => row.year))]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter(
      (row) =>
        row.state === selectedState &&
        row.year === Number(selectedYear)
    );
  }, [data, selectedState, selectedYear]);

  const selectedRow = useMemo(() => {
    return (
      data.find(
        (row) =>
          row.state === selectedState &&
          row.year === Number(selectedYear) &&
          row.month === Number(selectedMonth)
      ) || null
    );
  }, [data, selectedState, selectedYear, selectedMonth]);

  const selectedPrediction = useMemo(
    () =>
      getStatePrediction(
        predictionData,
        selectedState,
        selectedYear,
        selectedMonth
      ),
    [predictionData, selectedState, selectedYear, selectedMonth]
  );

  const monthlyTrend = useMemo(() => {
    return MONTHS.map((monthName, index) => {
      const monthNumber = index + 1;
      const row = filteredData.find((item) => item.month === monthNumber);

      return {
        month: monthName.slice(0, 3),
        monthNumber,
        HCHO: row ? row.HCHO : null,
        NDVI: row?.NDVI ?? null,
        fire_count: row ? row.fire_count : null,
        wind_speed: row ? row.wind_speed : null,
        HCHO_anomaly: row ? row.HCHO_anomaly : null,
        HCHO_hotspot: row ? row.HCHO_hotspot : null,
        NDVI_observed: row ? row.NDVI_observed : 0,
      };
    });
  }, [filteredData]);

  const yearlySummary = useMemo(() => {
    const validHCHO = filteredData.filter((row) => Number.isFinite(row.HCHO));
    const validNDVI = filteredData.filter(
      (row) => row.NDVI !== null && Number.isFinite(row.NDVI)
    );

    const average = (rows, key) =>
      rows.length
        ? rows.reduce((sum, row) => sum + numberValue(row[key]), 0) /
          rows.length
        : null;

    return {
      averageHCHO: average(validHCHO, "HCHO"),
      averageNDVI: average(validNDVI, "NDVI"),
      totalFires: filteredData.reduce(
        (sum, row) => sum + numberValue(row.fire_count),
        0
      ),
      averageWind: average(filteredData, "wind_speed"),
      hotspotMonths: filteredData.filter(
        (row) => numberValue(row.HCHO_hotspot) === 1
      ).length,
      observedNDVIMonths: validNDVI.length,
    };
  }, [filteredData]);

  const riskStatus = getRiskStatus(selectedRow);

  const changePage = (pageName) => {
    setActivePage(pageName);
    setSidebarOpen(false);
  };

  const renderFilters = () => (
    <div className="filters">
      <div className="filter-group">
        <label htmlFor="state-filter">State</label>
        <select
          id="state-filter"
          value={selectedState}
          onChange={(event) => setSelectedState(event.target.value)}
        >
          {STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="year-filter">Year</label>
        <select
          id="year-filter"
          value={selectedYear}
          onChange={(event) => setSelectedYear(event.target.value)}
        >
          {years.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="month-filter">Month</label>
        <select
          id="month-filter"
          value={selectedMonth}
          onChange={(event) => setSelectedMonth(event.target.value)}
        >
          {MONTHS.map((month, index) => (
            <option key={month} value={String(index + 1)}>
              {month}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderSummaryCards = () => (
    <div className="summary-grid">
      <div className="summary-card">
        <div className="summary-card-top">
          <span>Average HCHO</span>
          <div className="summary-icon purple">
            <Activity size={20} />
          </div>
        </div>
        <h2>{formatNumber(yearlySummary.averageHCHO, 6)}</h2>
        <p>Mean across available months in {selectedYear}</p>
      </div>

      <div className="summary-card">
        <div className="summary-card-top">
          <span>Average NDVI</span>
          <div className="summary-icon green">
            <Leaf size={20} />
          </div>
        </div>
        <h2>{formatNumber(yearlySummary.averageNDVI, 3)}</h2>
        <p>
          {yearlySummary.observedNDVIMonths} months with observed NDVI values
        </p>
      </div>

      <div className="summary-card">
        <div className="summary-card-top">
          <span>Total Fire Count</span>
          <div className="summary-icon orange">
            <Flame size={20} />
          </div>
        </div>
        <h2>{yearlySummary.totalFires.toLocaleString()}</h2>
        <p>Sum of available monthly fire counts</p>
      </div>

      <div className="summary-card">
        <div className="summary-card-top">
          <span>Average Wind Speed</span>
          <div className="summary-icon blue">
            <Wind size={20} />
          </div>
        </div>
        <h2>{formatNumber(yearlySummary.averageWind, 3)}</h2>
        <p>Mean wind speed across available months</p>
      </div>
    </div>
  );

  const renderRiskBanner = () => (
    <div className={`risk-banner ${riskStatus.className}`}>
      <div className="risk-banner-icon">
        <AlertTriangle size={22} />
      </div>
      <div>
        <h3>{riskStatus.label}</h3>
        <p>{riskStatus.description}</p>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <>
      {renderSummaryCards()}

      <div className="section-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Monthly HCHO Trend</h2>
              <p>
                {selectedState} · {selectedYear}
              </p>
            </div>
          </div>

          <div className="chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="HCHO"
                  name="HCHO"
                  stroke="#6c63ff"
                  strokeWidth={3}
                  connectNulls
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Monthly Fire Count</h2>
              <p>
                {selectedState} · {selectedYear}
              </p>
            </div>
          </div>

          <div className="chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="fire_count"
                  name="Fire count"
                  fill="#f59e0b"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Selected Month Risk Indicator</h2>
            <p>
              {selectedState} · {MONTHS[Number(selectedMonth) - 1]}{" "}
              {selectedYear}
            </p>
          </div>
        </div>

        {renderRiskBanner()}

        {selectedRow ? (
          <div className="indicator-grid">
            <div className="indicator-item">
              <span>HCHO</span>
              <strong>{formatNumber(selectedRow.HCHO, 6)}</strong>
            </div>
            <div className="indicator-item">
              <span>HCHO anomaly</span>
              <strong>{formatNumber(selectedRow.HCHO_anomaly, 6)}</strong>
            </div>
            <div className="indicator-item">
              <span>NDVI</span>
              <strong>{formatNumber(selectedRow.NDVI, 3)}</strong>
            </div>
            <div className="indicator-item">
              <span>Wind speed</span>
              <strong>{formatNumber(selectedRow.wind_speed, 3)}</strong>
            </div>
            <div className="indicator-item">
              <span>Fire count</span>
              <strong>{numberValue(selectedRow.fire_count).toLocaleString()}</strong>
            </div>
            <div className="indicator-item">
              <span>HCHO hotspot flag</span>
              <strong>
                {selectedRow.HCHO_hotspot === 1 ? "Present" : "Not present"}
              </strong>
            </div>
          </div>
        ) : (
          <p className="empty-message">
            No data is available for the selected state, year, and month.
          </p>
        )}
      </section>

      <section className="panel map-panel">
        <div className="panel-heading">
          <div>
            <h2>Regional Risk Map</h2>
            <p>Historical indicators and model forecast for the selected month</p>
          </div>
          <button
            className="text-button"
            onClick={() => changePage("Map View")}
          >
            Open map
          </button>
        </div>

        <RegionalMap
          data={data}
          predictionData={predictionData}
          selectedYear={Number(selectedYear)}
          selectedMonth={Number(selectedMonth)}
        />
      </section>
    </>
  );

  const renderMapPage = () => (
    <section className="panel map-panel">
      <div className="panel-heading">
        <div>
          <h2>Regional Map View</h2>
          <p>
            Observed HCHO and model patch risk · {MONTHS[Number(selectedMonth) - 1]}{" "}
            {selectedYear}
          </p>
        </div>
      </div>

      <RegionalMap
        data={data}
        predictionData={predictionData}
        selectedYear={Number(selectedYear)}
        selectedMonth={Number(selectedMonth)}
      />

      <div className="map-legend">
        <span><i className="legend-dot legend-risk-high" /> High potential risk</span>
        <span><i className="legend-dot legend-risk-moderate" /> Moderate potential risk</span>
        <span><i className="legend-dot legend-risk-low" /> Low potential risk</span>
        <span><i className="legend-dot legend-gray" /> Insufficient data</span>
      </div>

      <p className="disclaimer">
        State boundaries are fixed. Historical fills use observed HCHO hotspot
        flags; colored points show CNN-LSTM patch predictions where available.
        Neither represents verified crop damage.
      </p>
    </section>
  );

  const renderMonthlyAnalysis = () => (
    <>
      <div className="section-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>HCHO and NDVI by Month</h2>
              <p>
                {selectedState} · {selectedYear}
              </p>
            </div>
          </div>

          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="HCHO"
                  name="HCHO"
                  stroke="#6c63ff"
                  strokeWidth={3}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="NDVI"
                  name="NDVI"
                  stroke="#16a34a"
                  strokeWidth={3}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="chart-note">
            HCHO and NDVI use different scales and units. Compare their patterns
            cautiously.
          </p>
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Wind Speed by Month</h2>
              <p>
                {selectedState} · {selectedYear}
              </p>
            </div>
          </div>

          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="wind_speed"
                  name="Wind speed"
                  stroke="#0284c7"
                  strokeWidth={3}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly Observation Table</h2>
            <p>Values for {selectedState} in {selectedYear}</p>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>HCHO</th>
                <th>Fire count</th>
                <th>Wind speed</th>
                <th>NDVI</th>
                <th>Hotspot flag</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTrend.map((row) => (
                <tr key={row.monthNumber}>
                  <td>{MONTHS[row.monthNumber - 1]}</td>
                  <td>{formatNumber(row.HCHO, 6)}</td>
                  <td>
                    {row.fire_count === null
                      ? "N/A"
                      : row.fire_count.toLocaleString()}
                  </td>
                  <td>{formatNumber(row.wind_speed, 3)}</td>
                  <td>{formatNumber(row.NDVI, 3)}</td>
                  <td>
                    {row.HCHO_hotspot === null
                      ? "N/A"
                      : row.HCHO_hotspot === 1
                      ? "Present"
                      : "Not present"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );

  const renderRiskIndicators = () => (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Risk Indicators</h2>
            <p>
              {selectedState} · {MONTHS[Number(selectedMonth) - 1]}{" "}
              {selectedYear}
            </p>
          </div>
        </div>

        <div className="model-status-box">
          <strong>Model-predicted risk</strong>
          <span>{predictionStatus === "available" ? "Prediction output loaded" : "Insufficient data"}</span>
          <p>
            Spatial CNN-LSTM patch predictions are aggregated by state for this
            map. Historical environmental indicators remain separate from the
            model forecast.
          </p>
        </div>

        <RegionalMap
          data={data}
          predictionData={predictionData}
          selectedYear={Number(selectedYear)}
          selectedMonth={Number(selectedMonth)}
          onSelectState={setSelectedState}
        />

        <div className="map-legend risk-legend">
          <span><i className="legend-dot legend-risk-high" /> High potential risk</span>
          <span><i className="legend-dot legend-risk-moderate" /> Moderate potential risk</span>
          <span><i className="legend-dot legend-risk-low" /> Low potential risk</span>
          <span><i className="legend-dot legend-gray" /> Insufficient data</span>
        </div>

        <div className="risk-detail-panel">
          <div className="panel-heading">
            <div>
              <h3>{selectedState}</h3>
              <p>{MONTHS[Number(selectedMonth) - 1]} {selectedYear}</p>
            </div>
            <span className={`risk-pill ${selectedPrediction ? "risk-pill-model" : "risk-pill-neutral"}`}>
              {getModelRisk(selectedPrediction)}
            </span>
          </div>
          <div className="indicator-grid">
            <div className="indicator-item"><span>Model probability / score</span><strong>{formatNumber(selectedPrediction?.predicted_probability ?? selectedPrediction?.probability ?? selectedPrediction?.risk_probability ?? selectedPrediction?.score, 3)}</strong></div>
            <div className="indicator-item"><span>HCHO</span><strong>{formatNumber(selectedRow?.HCHO, 6)}</strong></div>
            <div className="indicator-item"><span>Wind speed</span><strong>{formatNumber(selectedRow?.wind_speed, 3)}</strong></div>
            <div className="indicator-item"><span>NDVI</span><strong>{formatNumber(selectedRow?.NDVI, 3)}</strong></div>
          </div>
          <p className="detail-explanation">
            Environmental context uses HCHO, wind speed, and NDVI when available.
            These indicators describe potential environmental stress and do not
            confirm crop damage or identify damaged farms.
          </p>
        </div>

        <div className="note-box">
          <h3>Data required for model-predicted risk</h3>
          <p>
            Spatial map points use held-out and next-month files under
            <code>public/data/spatial_cnn_lstm_*.csv</code>. Earlier dates use
            observed state-level HCHO hotspot flags, not reconstructed model
            forecasts. Add
            <code>public/data/india_states.geojson</code> with state-name
            properties for filled boundaries.
          </p>
          <p className="disclaimer">
            These are preliminary state-level predictions, not verified
            crop-damage assessments.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Yearly Summary</h2>
            <p>{selectedState} · {selectedYear}</p>
          </div>
        </div>

        <div className="indicator-grid">
          <div className="indicator-item">
            <span>Months with records</span>
            <strong>{filteredData.length}</strong>
          </div>
          <div className="indicator-item">
            <span>Months with hotspot flag</span>
            <strong>{yearlySummary.hotspotMonths}</strong>
          </div>
          <div className="indicator-item">
            <span>Months with observed NDVI</span>
            <strong>{yearlySummary.observedNDVIMonths}</strong>
          </div>
        </div>
      </section>
    </>
  );

  const [predictYear, setPredictYear] = useState("2026");
  const [predictMonth, setPredictMonth] = useState("5");
  const [predictCity, setPredictCity] = useState("");
  const [predictResult, setPredictResult] = useState(null);
  const [cityError, setCityError] = useState("");

  const computeARI = (hcho, hchoAnomaly, fireCount, windSpeed, ndvi) => {
    const hchoNorm = Math.min(hcho / 0.0004, 1);
    const anomalyNorm = Math.min(Math.max(hchoAnomaly / 0.0002, 0), 1);
    const fireNorm = Math.min(fireCount / 0.5, 1);
    const windNorm = Math.min(windSpeed / 3, 1);
    const ndviNorm = ndvi !== null ? Math.min(Math.max(ndvi, 0), 1) : 0.5;
    return Math.min(Math.max(hchoNorm * 0.35 + anomalyNorm * 0.25 + fireNorm * 0.2 + windNorm * 0.1 - ndviNorm * 0.1 + 0.1, 0), 1);
  };

  const handlePredict = () => {
    setCityError("");
    setPredictResult(null);

    if (!predictCity.trim()) {
      setCityError("Please enter a city or state name.");
      return;
    }

    const { state: resolvedState, matched } = resolveCity(predictCity);
    if (!matched || !resolvedState) {
      setCityError(`"${predictCity}" could not be matched to Punjab, Haryana, or Uttar Pradesh. Try a major city in these states.`);
      return;
    }

    const yr = Number(predictYear);
    const mo = Number(predictMonth);

    const exactRow = data.find((r) => r.state === resolvedState && r.year === yr && r.month === mo);
    const predRow = predictionData.find(
      (r) => r.state === resolvedState && Number(r.year) === yr && Number(r.month) === mo
    );

    if (exactRow) {
      const ari = computeARI(exactRow.HCHO, exactRow.HCHO_anomaly, exactRow.fire_count, exactRow.wind_speed, exactRow.NDVI);
      const modelProb = predRow ? Number(predRow.predicted_probability) : null;
      const finalScore = modelProb !== null ? ari * 0.5 + modelProb * 0.5 : ari;
      setPredictResult({ ari: finalScore, hotspot: exactRow.HCHO_hotspot === 1, modelProb, source: "observed", row: exactRow, resolvedState });
    } else {
      const sameMonthRows = data.filter((r) => r.state === resolvedState && r.month === mo);
      if (sameMonthRows.length === 0) {
        setPredictResult({ error: `No historical data for ${resolvedState} in ${MONTHS[mo - 1]}.` });
        return;
      }
      const avg = (key) => sameMonthRows.reduce((s, r) => s + (r[key] ?? 0), 0) / sameMonthRows.length;
      const avgHCHO = avg("HCHO"), avgAnomaly = avg("HCHO_anomaly"), avgFire = avg("fire_count"), avgWind = avg("wind_speed");
      const ndviRows = sameMonthRows.filter((r) => r.NDVI !== null);
      const avgNDVI = ndviRows.length ? ndviRows.reduce((s, r) => s + r.NDVI, 0) / ndviRows.length : null;
      const ari = computeARI(avgHCHO, avgAnomaly, avgFire, avgWind, avgNDVI);
      const modelProb = predRow ? Number(predRow.predicted_probability) : null;
      const finalScore = modelProb !== null ? ari * 0.5 + modelProb * 0.5 : ari;
      const hotspot = predRow
        ? Number(predRow.predicted_hotspot) === 1
        : sameMonthRows.filter((r) => r.HCHO_hotspot === 1).length / sameMonthRows.length > 0.5;
      setPredictResult({ ari: finalScore, hotspot, modelProb, source: "estimated", avgHCHO, avgFire, avgWind, avgNDVI, resolvedState });
    }
  };

  const renderFuturePredict = () => {
    const ariLevel = predictResult && !predictResult.error
      ? predictResult.ari >= 0.65 ? "High Risk" : predictResult.ari >= 0.35 ? "Moderate Risk" : "Low Risk"
      : null;
    const isSafe = ariLevel === "Low Risk";
    const ariPct = predictResult && !predictResult.error ? Math.round(predictResult.ari * 100) : 0;
    const verdictClass = ariLevel === "High Risk" ? "verdict-high" : ariLevel === "Moderate Risk" ? "verdict-moderate" : "verdict-low";
    const barColor = ariLevel === "High Risk" ? "#c43d3d" : ariLevel === "Moderate Risk" ? "#e58b24" : "#21966b";

    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Future Agricultural Risk Prediction</h2>
            <p>Enter a city name, year, and month to predict the ARI level</p>
          </div>
        </div>

        <div className="predict-form">
          <div className="filter-group" style={{ flex: "2 1 220px", maxWidth: 320 }}>
            <label htmlFor="pred-city">City / Place</label>
            <input
              id="pred-city"
              type="text"
              placeholder="e.g. Ludhiana, Panipat, Kanpur…"
              value={predictCity}
              onChange={(e) => { setPredictCity(e.target.value); setCityError(""); setPredictResult(null); }}
              onKeyDown={(e) => e.key === "Enter" && handlePredict()}
              className="predict-input"
            />
          </div>
          <div className="filter-group">
            <label htmlFor="pred-year">Year</label>
            <input
              id="pred-year"
              type="number"
              min="2020"
              max="2035"
              value={predictYear}
              onChange={(e) => setPredictYear(e.target.value)}
              className="predict-input"
            />
          </div>
          <div className="filter-group">
            <label htmlFor="pred-month">Month</label>
            <select id="pred-month" value={predictMonth} onChange={(e) => setPredictMonth(e.target.value)}>
              {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
          </div>
          <button className="primary-button predict-btn" onClick={handlePredict}>Predict</button>
        </div>

        {cityError && (
          <div className="city-error">
            <AlertTriangle size={15} />
            <span>{cityError}</span>
            <p className="city-hint">Supported cities include: Ludhiana, Amritsar, Chandigarh (Punjab) · Gurugram, Panipat, Karnal (Haryana) · Lucknow, Kanpur, Agra, Noida (Uttar Pradesh)</p>
          </div>
        )}

        {predictResult && (
          predictResult.error ? (
            <div className="risk-banner risk-neutral" style={{ marginTop: 20 }}>
              <div className="risk-banner-icon"><AlertTriangle size={20} /></div>
              <div><h3>Unable to predict</h3><p>{predictResult.error}</p></div>
            </div>
          ) : (
            <div className="predict-result">
              <div className="city-resolved-tag">
                📍 <strong>{predictCity}</strong> resolved to state: <strong>{predictResult.resolvedState}</strong>
                {predictResult.source === "estimated" && <span className="estimated-tag">estimated from historical data</span>}
              </div>

              <div className={`predict-verdict ${verdictClass}`}>
                <div className="verdict-top">
                  <span className="verdict-label">{ariLevel}</span>
                  <span className="verdict-safe">{isSafe ? "✓ Safe for Agriculture" : "✗ Not Recommended for Agriculture"}</span>
                </div>
                <div className="ari-bar-wrap">
                  <div className="ari-bar-track">
                    <div className="ari-bar-fill" style={{ width: `${ariPct}%`, background: barColor }} />
                  </div>
                  <span className="ari-score">ARI Score: {predictResult.ari.toFixed(3)}</span>
                </div>
              </div>

              <div className="indicator-grid" style={{ marginTop: 16 }}>
                <div className="indicator-item"><span>City / Place</span><strong>{predictCity}</strong></div>
                <div className="indicator-item"><span>State</span><strong>{predictResult.resolvedState}</strong></div>
                <div className="indicator-item"><span>Period</span><strong>{MONTHS[Number(predictMonth) - 1]} {predictYear}</strong></div>
                <div className="indicator-item"><span>Hotspot Signal</span><strong>{predictResult.hotspot ? "Present" : "Not present"}</strong></div>
                {predictResult.modelProb !== null && (
                  <div className="indicator-item"><span>Model Probability</span><strong>{predictResult.modelProb.toFixed(3)}</strong></div>
                )}
                {predictResult.source === "observed" ? (
                  <>
                    <div className="indicator-item"><span>HCHO</span><strong>{formatNumber(predictResult.row.HCHO, 6)}</strong></div>
                    <div className="indicator-item"><span>NDVI</span><strong>{formatNumber(predictResult.row.NDVI, 3)}</strong></div>
                  </>
                ) : (
                  <>
                    <div className="indicator-item"><span>Est. HCHO</span><strong>{formatNumber(predictResult.avgHCHO, 6)}</strong></div>
                    <div className="indicator-item"><span>Est. NDVI</span><strong>{formatNumber(predictResult.avgNDVI, 3)}</strong></div>
                  </>
                )}
              </div>

              <p className="detail-explanation">
                {predictResult.source === "estimated"
                  ? `No direct observation for ${predictYear}. ARI estimated from historical ${MONTHS[Number(predictMonth) - 1]} averages in ${predictResult.resolvedState}.`
                  : `ARI computed from observed data for ${MONTHS[Number(predictMonth) - 1]} ${predictYear} in ${predictResult.resolvedState}.`}
                {predictResult.modelProb !== null && " CNN-LSTM model probability is blended into the final score."}
              </p>

              <div className="note-box" style={{ marginTop: 16 }}>
                <h3>ARI Level Guide</h3>
                <ul>
                  <li><strong>Low Risk (ARI &lt; 0.35):</strong> Conditions are generally favourable. Agriculture is likely safe.</li>
                  <li><strong>Moderate Risk (0.35 – 0.65):</strong> Elevated HCHO or fire activity detected. Monitor closely before planting.</li>
                  <li><strong>High Risk (ARI &gt; 0.65):</strong> Strong stress signals present. Agriculture not recommended without further assessment.</li>
                </ul>
              </div>
            </div>
          )
        )}
      </section>
    );
  };

  const renderPageContent = () => {
    switch (activePage) {
      case "Map View":
        return renderMapPage();
      case "Monthly Analysis":
        return renderMonthlyAnalysis();
      case "Risk Indicators":
        return renderRiskIndicators();
      case "Future Predict":
        return renderFuturePredict();
      case "Dashboard":
      default:
        return renderDashboard();
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <RefreshCw className="loading-spinner" size={30} />
        <h2>Loading agricultural risk data...</h2>
        <p>Please wait while the dataset is being prepared.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <AlertTriangle size={32} />
        <h2>Unable to load dataset</h2>
        <p>{error}</p>
        <p>
          Check that the CSV file is located at{" "}
          <code>frontend/public/data/agricultural_risk_master_clean.csv</code>.
        </p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <Leaf size={25} />
          </div>
          <div>
            <h2>AgriSense</h2>
            <p>Risk Assessment</p>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${activePage === name ? "active" : ""}`}
              onClick={() => changePage(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="status-indicator" />
            <div>
              <strong>Historical dataset</strong>
              <p>{data.length} observations</p>
              <p>{predictionData.length} model patch forecasts</p>
            </div>
          </div>
          <p className="sidebar-footer">Agricultural Risk Dashboard</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="menu-button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={23} />
          </button>

          <div className="page-heading">
            <span className="eyebrow">AGRICULTURAL MONITORING</span>
            <h1>
              {activePage === "Dashboard"
                ? "Agricultural Risk Assessment"
                : activePage === "Future Predict"
                ? "Future Risk Prediction"
                : activePage}
            </h1>
            <p>Satellite-derived environmental indicators and monthly analysis</p>
          </div>

          <div className="topbar-badge">
            <span className="status-indicator" />
            Data available
          </div>
        </header>

        <div className="page-body">
          {renderFilters()}
          {renderPageContent()}

          <footer className="page-footer">
            <p>
              This dashboard presents exploratory satellite-derived indicators.
              It does not confirm crop damage or provide field-level diagnoses.
              Model outputs and hotspot indicators require independent validation
              before operational use.
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;