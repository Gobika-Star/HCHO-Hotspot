  const renderMapPage = () => (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Regional Risk Map</h2>
          <p>
            {selectedState} · {selectedYear} · {MONTHS[Number(selectedMonth) - 1]}
          </p>
        </div>
      </div>

      <RegionalMap
        data={data}
        predictionData={predictionData}
        selectedState={selectedState}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onSelectState={setSelectedState}
      />

      <div className="map-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ backgroundColor: RISK_COLORS.high }} />
          High potential risk
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ backgroundColor: RISK_COLORS.moderate }} />
          Moderate potential risk
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ backgroundColor: RISK_COLORS.low }} />
          Low potential risk
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ backgroundColor: RISK_COLORS.insufficient }} />
          Insufficient data
        </span>
      </div>

      {predictionStatus === "unavailable" && (
        <div className="note-box">
          <h3>Model predictions unavailable</h3>
          <p>
            State-level model predictions require{ }
            <code>public/data/cnn_lstm_predictions.csv</code>. Until that file is
            available, map polygons are shown without model-derived risk shading.
          </p>
        </div>
      )}
    </section>
  );

