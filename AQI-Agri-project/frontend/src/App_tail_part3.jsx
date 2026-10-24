  const renderRiskIndicators = () => (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Current Observation Risk Indicators</h2>
            <p>
              {selectedState} · {selectedYear} · {MONTHS[Number(selectedMonth) - 1]}
            </p>
          </div>
        </div>

        {renderRiskBanner()}

        {selectedRow ? (
          <>
            <div className="indicator-grid">
              <div className="indicator-item">
                <span>Model probability / score</span>
                <strong>
                  {formatNumber(
                    selectedPrediction?.probability ??
                      selectedPrediction?.risk_probability ??
                      selectedPrediction?.score,
                    3
                  )}
                </strong>
              </div>
              <div className="indicator-item">
                <span>HCHO</span>
                <strong>{formatNumber(selectedRow?.HCHO, 6)}</strong>
              </div>
              <div className="indicator-item">
                <span>Wind speed</span>
                <strong>{formatNumber(selectedRow?.wind_speed, 3)}</strong>
              </div>
              <div className="indicator-item">
                <span>NDVI</span>
                <strong>{formatNumber(selectedRow?.NDVI, 3)}</strong>
              </div>
              <div className="indicator-item">
                <span>Fire count</span>
                <strong>{formatNumber(selectedRow?.fire_count, 0)}</strong>
              </div>
              <div className="indicator-item">
                <span>HCHO anomaly</span>
                <strong>{formatNumber(selectedRow?.HCHO_anomaly, 3)}</strong>
              </div>
              <div className="indicator-item">
                <span>HCHO hotspot</span>
                <strong>{selectedRow?.HCHO_hotspot ?? "N/A"}</strong>
              </div>
              <div className="indicator-item">
                <span>Model risk category</span>
                <strong>{getModelRisk(selectedPrediction)}</strong>
              </div>
            </div>

            <div className="note-box">
              <h3>How to read these indicators</h3>
              <p>
                HCHO hotspot flags are satellite-derived proxies and do not confirm
                crop damage. Model outputs are preliminary state-level predictions
                and require independent validation before operational use.
              </p>
            </div>
          </>
        ) : (
          <div className="note-box">
            <h3>No matching observation</h3>
            <p>
              No record is available for the currently selected state, year, and
              month combination.
            </p>
          </div>
        )}
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


