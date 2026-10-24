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
} from "lucide-react";

import "./App.css";
import RegionalMap from "./RegionalMap";

const CSV_PATH = "/data/agricultural_risk_master_clean.csv";
const PREDICTION_PATH = "/data/cnn_lstm_predictions.csv";

const STATES = ["Punjab", "Haryana", "Uttar Pradesh"];

const RISK_COLORS = {
  high: "#c43d3d",
  moderate: "#e58b24",
  low: "#21966b",
  insufficient: "#8994a3",
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
  const value =
    row?.predicted_probability ??
    row?.risk_category ??
    row?.predicted_risk ??
    row?.category ??
    row?.prediction;
  if (value === null || value === undefined || value === "") {
    return "Insufficient data";
  }
  const num = Number(value);
  if (Number.isFinite(num)) {
    if (num >= 0.5) return "High potential risk";
    if (num >= 0.2) return "Moderate potential risk";
    return "Low potential risk";
  }
  const normalized = String(value).toLowerCase();
  if (normalized.includes("high")) return "High potential risk";
  if (normalized.includes("moderate") || normalized.includes("medium"))
    return "Moderate potential risk";
  if (normalized.includes("low")) return "Low potential risk";
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
