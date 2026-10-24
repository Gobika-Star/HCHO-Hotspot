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
      predictionData.find(
        (row) =>
          row.state === selectedState &&
          Number(row.year) === Number(selectedYear) &&
          Number(row.month) === Number(selectedMonth)
      ) || null,
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
