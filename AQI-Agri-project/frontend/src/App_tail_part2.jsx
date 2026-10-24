  const renderMonthlyAnalysis = () => (
    <>
      <div className="section-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Monthly HCHO Trend</h2>
              <p>{selectedState} · {selectedYear}</p>
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
              <h2>Monthly NDVI Trend</h2>
              <p>{selectedState} · {selectedYear}</p>
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
                  dataKey="NDVI"
                  name="NDVI"
                  stroke="#21966b"
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
              <p>{selectedState} · {selectedYear}</p>
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

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Monthly Wind Speed</h2>
              <p>{selectedState} · {selectedYear}</p>
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
                  dataKey="wind_speed"
                  name="Wind speed"
                  stroke="#2563eb"
                  strokeWidth={3}
                  connectNulls
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

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
          <div className="indicator-item">
            <span>Total fire count</span>
            <strong>{yearlySummary.totalFires.toLocaleString()}</strong>
          </div>
        </div>
      </section>
    </>
  );

