"use strict";

(() => {
  const C = FuelCalc;
  const results = document.querySelector("#test-results");
  let passed = 0;
  let failed = 0;
  function equal(actual, expected) {
    if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
  }
  function near(actual, expected, tolerance = 0.000001) {
    if (Math.abs(actual - expected) > tolerance) throw new Error(`Expected about ${expected}, got ${actual}`);
  }
  function rejects(action) {
    let threw = false;
    try { action(); } catch { threw = true; }
    if (!threw) throw new Error("Expected invalid input to be rejected.");
  }
  function test(name, action) {
    const item = document.createElement("li");
    try {
      action();
      passed++;
      item.textContent = `PASS: ${name}`;
      item.className = "test-pass";
    } catch (error) {
      failed++;
      item.textContent = `FAIL: ${name}: ${error.message}`;
      item.className = "test-fail";
    }
    results.append(item);
  }
  const fill = {
    tanks: [{ before: 59, gallons: 14.918, nominal: 32 }, { before: 56, gallons: 21.531, nominal: 50 }],
    price: 5.899, receipt: 215.01
  };
  const calibration = C.calibrateFill(fill);
  const job = { tanks: [{ start: 90, end: 65 }, { start: 100, end: 66 }], price: 5.899 };
  const estimate = { miles: 124, loadedFraction: 2 / 3, baseline: 15.84, loadedPenalty: 5, emptyPenalty: 0, price: 6.699 };

  test("Calibration A rates, capacities, nominal warnings and receipt", () => {
    near(calibration.tanks[0].rate, 0.363854);
    near(calibration.tanks[1].rate, 0.489341);
    equal(C.decimal(calibration.tanks[0].capacity, 3), "36.385");
    equal(C.decimal(calibration.tanks[1].capacity, 3), "48.934");
    equal(calibration.tanks[0].mismatch, true);
    equal(calibration.tanks[1].mismatch, false);
    equal(C.decimal(calibration.gallons, 3), "36.449");
    equal(C.money(calibration.cost), "$215.01");
    equal(calibration.receiptMismatch, false);
  });
  test("Job 1 calibrated burn, cost and nominal comparison", () => {
    const result = C.calculateJob(job, calibration);
    equal(C.decimal(result.tanks[0].gallons), "9.10");
    equal(C.decimal(result.tanks[1].gallons), "16.64");
    equal(C.decimal(result.gallons), "25.73");
    equal(C.money(result.cost), "$151.80");
    equal(result.tanks.some(tank => tank.extrapolated), false);
    equal(C.decimal(result.nominalGallons), "25.00");
    equal(C.money(result.nominalCost), "$147.48");
    equal(C.money(result.difference), "$4.33");
  });
  test("Fill-to-fill MPG: 30504.4 to 31137.9 at 36.449 gal", () => {
    equal(C.decimal(C.fillMpg(30504.4, 31137.9, 36.449, true, true)), "17.38");
  });
  test("Estimate 1: no loaded miles", () => {
    const result = C.estimate({ ...estimate, loadedFraction: 0 });
    equal(C.decimal(result.gallons), "7.83");
    equal(C.money(result.cost), "$52.44");
  });
  test("Estimate 2: two-thirds loaded", () => {
    const result = C.estimate(estimate);
    equal(C.decimal(result.loadedGallons), "7.63");
    equal(C.decimal(result.emptyGallons), "2.61");
    equal(C.decimal(result.gallons), "10.24");
    equal(C.decimal(result.mpg), "12.11");
    equal(C.money(result.cost), "$68.57");
    equal(C.money(result.quote), "$70.00");
  });
  test("Estimate 3: empty-trailer penalty", () => {
    const result = C.estimate({ ...estimate, emptyPenalty: 2 });
    equal(C.decimal(result.gallons), "10.61");
    equal(C.money(result.cost), "$71.09");
    equal(C.money(result.quote), "$75.00");
  });
  test("Extrapolation warning and exact calibration boundary", () => {
    equal(C.calculateJob({ ...job, tanks: [{ start: 50, end: 30 }, job.tanks[1]] }, calibration).tanks[0].extrapolated, true);
    equal(C.calculateJob({ ...job, tanks: [{ start: 100, end: 59 }, { start: 100, end: 56 }] }, calibration).tanks.some(tank => tank.extrapolated), false);
  });
  test("Single-tank gasoline or diesel actuals and segment MPG", () => {
    const single = C.calibrateFill({ tanks: [{ before: 50, gallons: 10, nominal: 20 }], price: 4 });
    const result = C.calculateJob({ tanks: [{ start: 100, end: 75 }], price: 4, odometerStart: 100, odometerEnd: 200 }, single);
    equal(result.gallons, 5);
    equal(result.mpg, 20);
    equal(C.money(result.cost), "$20.00");
  });
  test("Half-up cents include binary float pitfalls and scientific notation", () => {
    equal(C.money(147.475), "$147.48");
    equal(C.money(1.005), "$1.01");
    equal(C.money(2.675), "$2.68");
    equal(C.money(-1.005), "-$1.01");
    equal(C.money(1e-7), "$0.00");
    equal(C.money(1e21), "$1000000000000000000000.00");
  });
  test("Receipt warning only above five cents", () => {
    const input = { tanks: [{ before: 50, gallons: 10, nominal: 20 }], price: 4 };
    equal(C.calibrateFill({ ...input, receipt: 40.05 }).receiptMismatch, false);
    equal(C.calibrateFill({ ...input, receipt: 40.051 }).receiptMismatch, true);
  });
  test("Nominal warning only above five percent", () => {
    equal(C.calibrateTank({ before: 0, gallons: 21, nominal: 20 }).mismatch, false);
    equal(C.calibrateTank({ before: 0, gallons: 21.001, nominal: 20 }).mismatch, true);
  });
  test("Calibration rejects impossible gauges, zero gallons and bad numbers", () => {
    [100, 101, -1, NaN].forEach(before => rejects(() => C.calibrateTank({ before, gallons: 10, nominal: 20 })));
    [0, -1, Infinity, "10"].forEach(gallons => rejects(() => C.calibrateTank({ before: 50, gallons, nominal: 20 })));
    rejects(() => C.calibrateFill({ ...fill, tanks: [] }));
  });
  test("Jobs reject rising gauges, mismatched tanks and incomplete odometers", () => {
    rejects(() => C.calculateJob({ ...job, tanks: [{ start: 50, end: 60 }, job.tanks[1]] }, calibration));
    rejects(() => C.calculateJob({ ...job, tanks: [job.tanks[0]] }, calibration));
    rejects(() => C.calculateJob({ ...job, odometerStart: 100 }, calibration));
    rejects(() => C.calculateJob({ ...job, odometerStart: 100, odometerEnd: 90 }, calibration));
  });
  test("Pending jobs can validate readings without a calibration", () => {
    C.validateJob({ tanks: [{ start: 80, end: 60 }], price: 4 });
    rejects(() => C.validateJob({ tanks: [{ start: -1, end: 60 }], price: 4 }));
  });
  test("Zero burn is valid but has no segment MPG", () => {
    const result = C.calculateJob({ ...job, tanks: [{ start: 90, end: 90 }, { start: 80, end: 80 }], odometerStart: 100, odometerEnd: 110 }, calibration);
    equal(result.gallons, 0);
    equal(result.mpg, null);
    equal(C.money(result.cost), "$0.00");
  });
  test("Estimates reject zero/negative effective MPG even on an unused leg", () => {
    rejects(() => C.estimate({ ...estimate, loadedPenalty: 15.84 }));
    rejects(() => C.estimate({ ...estimate, emptyPenalty: 16 }));
    rejects(() => C.estimate({ ...estimate, loadedFraction: 0, loadedPenalty: 16 }));
    rejects(() => C.estimate({ ...estimate, loadedFraction: 1.01 }));
    rejects(() => C.estimate({ ...estimate, miles: 0 }));
  });
  test("All-loaded trips and quotes already at a five-dollar boundary", () => {
    const result = C.estimate({ miles: 100, baseline: 20, loadedFraction: 1, loadedPenalty: 0, emptyPenalty: 0, price: 4 });
    equal(result.emptyGallons, 0);
    equal(result.quote, 20);
  });
  test("Fill-to-fill rejects partial fills and reversed odometers", () => {
    rejects(() => C.fillMpg(100, 200, 10, false, true));
    rejects(() => C.fillMpg(100, 200, 10, true, false));
    rejects(() => C.fillMpg(200, 100, 10, true, true));
  });
  test("Overflow is reported rather than displaying Infinity", () => {
    rejects(() => C.estimate({ ...estimate, miles: Number.MAX_VALUE, price: Number.MAX_VALUE }));
    rejects(() => C.calibrateFill({ ...fill, price: Number.MAX_VALUE }));
  });
  const normalEconomy = { baseline: 20, cargoPenalty: 2, emptyPenalty: 4, towingPenalty: 8 };
  const normalMix = { cargoMiles: 0, emptyMiles: 0, towingMiles: 0 };
  test("Normal non-job driving needs no penalty or calibration", () => {
    const result = C.trip({ miles: 100, price: 4, economy: normalEconomy, mix: normalMix });
    equal(result.gallons, 5);
    equal(C.money(result.cost), "$20.00");
    equal(result.legs[0].miles, 100);
  });
  test("Four-mode mixed trip subtracts each penalty independently", () => {
    const result = C.trip({ miles: 100, price: 4, economy: normalEconomy, mix: { cargoMiles: 20, emptyMiles: 20, towingMiles: 40 } });
    equal(result.legs[0].miles, 20);
    equal(result.legs[1].mpg, 18);
    equal(result.legs[2].mpg, 16);
    equal(result.legs[3].mpg, 12);
    equal(C.money(result.cost), "$26.78");
    equal(C.decimal(result.mpg), "14.94");
  });
  test("Mixed miles reject double-counting but allow decimal boundaries", () => {
    rejects(() => C.trip({ miles: 100, price: 4, economy: normalEconomy, mix: { ...normalMix, cargoMiles: 101 } }));
    rejects(() => C.trip({ miles: 100, price: 4, economy: normalEconomy, mix: { ...normalMix, towingMiles: -1 } }));
    near(C.trip({ miles: 0.3, price: 4, economy: normalEconomy, mix: { ...normalMix, cargoMiles: 0.1, emptyMiles: 0.2 } }).legs[0].miles, 0);
    rejects(() => C.economy({ ...normalEconomy, cargoPenalty: 20 }));
    rejects(() => C.economy({ ...normalEconomy, towingPenalty: 21 }));
  });
  test("Odometer actuals require a complete increasing pair", () => {
    near(C.odometerMiles(30504.4, 31137.9), 633.5);
    rejects(() => C.odometerMiles(null, 100));
    rejects(() => C.odometerMiles(100, 100));
    rejects(() => C.odometerMiles(100, 90));
  });
  const D = FuelData;
  const fixture = () => {
    const state = D.defaults();
    const meta = { date: "2026-01-02", createdAt: "2026-01-02T12:00:00.000Z" };
    state.profiles.push({ id: "vehicle-a", name: "Sample vehicle", ...D.setup(state.settings), ...normalEconomy, mainNominal: 20, activeCalibrationId: "fill-a" });
    state.calibrations.push({
      ...meta, id: "fill-a", vehicleId: "vehicle-a", tanks: [{ before: 50, gallons: 10, nominal: 20 }],
      price: 6, receipt: null, odometer: 200, full: true, previousFillId: null
    });
    state.jobs.push({
      ...meta, id: "gauge-job", vehicleId: "vehicle-a", vehicleName: "Sample vehicle", name: "Pending haul", notes: "",
      method: "gauge", status: "pending", price: 4, tanks: [{ start: 100, end: 75 }],
      odometerStart: 100, odometerEnd: 200, calibrationId: null, economy: null, mix: null
    }, {
      ...meta, id: "distance-job", vehicleId: "vehicle-a", vehicleName: "Sample vehicle", name: "Airport pickup", notes: "",
      method: "distance", status: "final", price: 4, tanks: [], odometerStart: 100, odometerEnd: 200,
      calibrationId: null, economy: { ...normalEconomy }, mix: { ...normalMix }
    });
    return D.validate(state);
  };
  test("Single-tank profiles and defaults accept blank or zero auxiliary capacity through backup round trips", () => {
    for (const auxNominal of [null, 0]) {
      const state = fixture();
      state.settings.auxNominal = auxNominal;
      state.profiles[0].auxNominal = auxNominal;
      const saved = D.validate(state);
      const restored = D.validate(JSON.parse(JSON.stringify(saved)));
      equal(restored.settings.auxNominal, 0);
      equal(restored.profiles[0].auxNominal, 0);
      equal(C.money(C.trip({ miles: 100, ...restored.jobs[1] }).cost), "$20.00");
    }
  });
  test("Enabling an auxiliary tank requires a positive capacity without weakening main tank validation", () => {
    const setup = { ...D.defaults().settings, auxNominal: 0 };
    for (const auxNominal of [null, 0, -1]) {
      rejects(() => D.setup({ ...setup, dual: true, auxNominal }));
    }
    equal(D.setup({ ...setup, dual: true, auxNominal: 50 }).auxNominal, 50);
    rejects(() => D.setup({ ...setup, auxNominal: -1 }));
    rejects(() => D.setup({ ...setup, mainNominal: 0 }));
  });
  test("Finalizing a pending job preserves job-day price, not refill price", () => {
    const result = D.finalize(fixture(), "fill-a", ["gauge-job"]);
    equal(result.jobs[0].price, 4);
    equal(result.jobs[0].status, "final");
    equal(C.money(C.calculateJob(result.jobs[0], C.calibrateFill(result.calibrations[0])).cost), "$20.00");
  });
  test("Vehicle isolation rejects cross-vehicle active fills, job fills and links", () => {
    const state = fixture();
    state.profiles.push({ ...state.profiles[0], id: "vehicle-b", name: "Other vehicle", activeCalibrationId: null });
    state.jobs[0].vehicleId = "vehicle-b";
    rejects(() => D.finalize(state, "fill-a", ["gauge-job"]));
    state.jobs[0].calibrationId = "fill-a";
    rejects(() => D.validate(state));
    state.jobs[0].calibrationId = null;
    state.profiles[1].activeCalibrationId = "fill-a";
    rejects(() => D.validate(state));
    state.profiles[1].activeCalibrationId = null;
    state.calibrations.push({ ...state.calibrations[0], id: "fill-b", vehicleId: "vehicle-b", odometer: 300, previousFillId: "fill-a" });
    rejects(() => D.validate(state));
  });
  test("Profile edits do not rewrite a mileage job's MPG snapshot", () => {
    const state = fixture();
    state.profiles[0].baseline = 30;
    const saved = D.validate(state).jobs[1];
    equal(C.money(C.trip({ miles: C.odometerMiles(saved.odometerStart, saved.odometerEnd), ...saved }).cost), "$20.00");
  });
  test("Version 1 migration preserves unassigned actuals and their prices", () => {
    const meta = { date: "2026-01-01", createdAt: "2026-01-01T12:00:00.000Z" };
    const legacy = {
      version: 1, settings: { price: 4, baseline: 16, loadedPenalty: 5, emptyPenalty: 2, mainNominal: 32, auxNominal: 50 },
      activeCalibrationId: "old-fill",
      calibrations: [{ ...meta, ...fill, id: "old-fill", odometer: null, previousFillId: null, full: true }],
      jobs: [{ ...meta, ...job, id: "old-job", name: "Legacy haul", notes: "", status: "final", calibrationId: "old-fill", odometerStart: null, odometerEnd: null }]
    };
    const result = D.validate(legacy);
    equal(result.version, 2);
    equal(result.profiles.length, 0);
    equal(result.jobs[0].vehicleId, null);
    equal(result.jobs[0].price, 5.899);
    equal(result.settings.towingPenalty, 5);
    equal(result.settings.cargoPenalty, 0);
    equal(result.settings.emptyPenalty, 2);
    equal(C.money(C.calculateJob(result.jobs[0], C.calibrateFill(result.calibrations[0])).cost), "$151.80");
    equal(legacy.version, 1);
  });
  test("Version 2 duplicate merges skip all exact duplicates", () => {
    const state = fixture();
    const merged = D.merge(state, structuredClone(state));
    equal(merged.profiles.length, 1);
    equal(merged.calibrations.length, 1);
    equal(merged.jobs.length, 2);
  });
  test("Conflicting merges remap profile/active-fill cycles and dependent jobs", () => {
    const state = fixture();
    const incoming = structuredClone(state);
    incoming.calibrations[0].tanks[0].gallons = 12;
    let counter = 0;
    const result = D.merge(state, incoming, () => `new-${++counter}`);
    equal(result.profiles.length, 2);
    equal(result.calibrations.length, 2);
    equal(result.jobs.length, 4);
    const imported = result.profiles.find(profile => profile.id !== "vehicle-a");
    const importedFill = result.calibrations.find(item => item.id === imported.activeCalibrationId);
    equal(importedFill.vehicleId, imported.id);
    equal(importedFill.tanks[0].gallons, 12);
    equal(result.jobs.filter(item => item.vehicleId === imported.id).length, 2);
    equal(state.calibrations[0].tanks[0].gallons, 10);
  });
  test("Invalid mileage backups and missing profile references are rejected", () => {
    const state = fixture();
    state.jobs[1].mix.cargoMiles = 101;
    rejects(() => D.validate(state));
    state.jobs[1].mix.cargoMiles = 0;
    state.jobs[1].vehicleId = "missing";
    rejects(() => D.validate(state));
    rejects(() => D.finalize(fixture(), "fill-a", ["missing"]));
  });
  const summary = document.querySelector("#test-summary");
  summary.textContent = `${passed} passed, ${failed} failed`;
  summary.className = failed ? "notice error" : "notice success";
  document.title = `${failed ? "FAIL" : "PASS"} | Fuel calculation tests`;
})();
