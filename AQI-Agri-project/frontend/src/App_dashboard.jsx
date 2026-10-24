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
          <>
            <div className="indicator-grid">
              <div className="indicator-item"><span>Model probability / score</span><strong>{formatNumber(selectedPrediction?.probability ?? selectedPrediction?.risk_probability ?? selectedPrediction?.score, 3)}</strong></div>
              <div className="indicator-item"><span>HCHO</span><strong>{formatNumber(selectedRow?.HCHO, 6)}</strong></div>
              <div className="indicator-item"><span>Wind speed</span><strong>{formatNumber(selectedRow?.wind_speed, 3)}</strong></div>
              <div className="indicator-item"><span>NDVI</span><strong>{formatNumber(selectedRow?.NDVI, 3)}</strong></div>
            </div>

            <p className="detail-explanation">
              Environmental context uses HCHO, wind speed, and NDVI when available.
              These indicators describe potential environmental stress and do not
              confirm crop damage or identify damaged farms.
            </p>
          </>
        ) : null}

        <div className="note-box">
          <h3>Data required for model-predicted risk</h3>
          <p>
            Add <code>public/data/cnn_lstm_predictions.csv</code> or connect a
            prediction API with state, year, month, a documented risk category
            or thresholded score, and an optional probability. Add
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
