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

