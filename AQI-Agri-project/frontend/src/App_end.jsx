  const renderPageContent = () => {
    switch (activePage) {
      case "Map View":
        return renderMapPage();
      case "Monthly Analysis":
        return renderMonthlyAnalysis();
      case "Risk Indicators":
        return renderRiskIndicators();
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
              <strong>Dataset loaded</strong>
              <p>{data.length} observations</p>
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
