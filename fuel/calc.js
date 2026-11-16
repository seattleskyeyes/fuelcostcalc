"use strict";

const FuelCalc = (() => {
  function number(value, label, min = 0, max = Infinity) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${label} must be a number from ${min} to ${max === Infinity ? "a finite maximum" : max}.`);
    }
    return value;
  }

  function positive(value, label) {
    number(value, label);
    if (value === 0) throw new Error(`${label} must be greater than zero.`);
    return value;
  }

  function tanks(values) {
    if (!Array.isArray(values) || values.length < 1 || values.length > 2) {
      throw new Error("Provide readings for one or two tanks.");
    }
  }

  // Round the decimal representation, not a binary float multiplied by 100.
  function decimal(value, places = 2) {
    if (!Number.isFinite(value)) throw new Error("Cannot display a non-finite result.");
    if (!Number.isInteger(places) || places < 0 || places > 6) throw new Error("Invalid decimal places.");
    const [coefficient, exponent = "0"] = Math.abs(value).toString().toLowerCase().split("e");
    const [whole, fraction = ""] = coefficient.split(".");
    const shift = Number(exponent) - fraction.length + places;
    let units = BigInt(whole + fraction);
    if (shift >= 0) {
      units *= 10n ** BigInt(shift);
    } else {
      const divisor = 10n ** BigInt(-shift);
      units = (units + divisor / 2n) / divisor;
    }
    const digits = units.toString().padStart(places + 1, "0");
    const sign = value < 0 && units !== 0n ? "-" : "";
    return sign + (places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits);
  }

  function money(value) {
    const text = decimal(value, 2);
    return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
  }

  function finiteResults(values) {
    if (values.some(value => !Number.isFinite(value))) {
      throw new Error("These inputs produce a result too large to calculate. Use smaller values.");
    }
  }

  function calibrateTank({ before, gallons, nominal }) {
    number(before, "Gauge before fill", 0, 100);
    if (before === 100) throw new Error("Gauge before fill must be below 100%.");
    positive(gallons, "Gallons pumped");
    positive(nominal, "Nominal capacity");
    const rate = gallons / (100 - before);
    const capacity = rate * 100;
    finiteResults([rate, capacity]);
    return { before, gallons, nominal, rate, capacity, mismatch: Math.abs(capacity - nominal) / nominal > 0.05 + 1e-12 };
  }

  function calibrateFill(input) {
    tanks(input.tanks);
    number(input.price, "Price per gallon");
    if (input.receipt != null) number(input.receipt, "Receipt total");
    const calibrated = input.tanks.map(calibrateTank);
    const gallons = calibrated.reduce((sum, tank) => sum + tank.gallons, 0);
    const cost = gallons * input.price;
    finiteResults([gallons, cost]);
    return {
      tanks: calibrated, gallons, cost,
      receiptMismatch: input.receipt != null && Math.abs(cost - input.receipt) > 0.05 + 1e-9
    };
  }

  function validateJob(input) {
    tanks(input.tanks);
    number(input.price, "Price per gallon");
    input.tanks.forEach((tank, index) => {
      number(tank.start, `Tank ${index + 1} start gauge`, 0, 100);
      number(tank.end, `Tank ${index + 1} end gauge`, 0, 100);
      if (tank.end > tank.start) throw new Error(`Tank ${index + 1} end gauge cannot exceed its start. Refueling or tank transfers invalidate gauge-drop actuals.`);
    });
    const hasStart = input.odometerStart != null;
    const hasEnd = input.odometerEnd != null;
    if (hasStart !== hasEnd) throw new Error("Enter both odometer readings, or leave both blank.");
    if (hasStart) {
      number(input.odometerStart, "Start odometer");
      number(input.odometerEnd, "End odometer");
      if (input.odometerEnd <= input.odometerStart) throw new Error("End odometer must be greater than start odometer.");
    }
  }

  function calculateJob(input, calibration) {
    validateJob(input);
    tanks(calibration.tanks);
    if (input.tanks.length !== calibration.tanks.length) throw new Error("Job and calibration must use the same number of tanks.");
    const details = input.tanks.map((tank, index) => {
      const calibrated = calibration.tanks[index];
      positive(calibrated.rate, "Calibration rate");
      positive(calibrated.nominal, "Nominal capacity");
      number(calibrated.before, "Calibration band", 0, 100);
      const drop = tank.start - tank.end;
      return {
        gallons: drop * calibrated.rate,
        nominalGallons: drop / 100 * calibrated.nominal,
        extrapolated: tank.end < calibrated.before
      };
    });
    const gallons = details.reduce((sum, tank) => sum + tank.gallons, 0);
    const nominalGallons = details.reduce((sum, tank) => sum + tank.nominalGallons, 0);
    const miles = input.odometerStart == null ? null : input.odometerEnd - input.odometerStart;
    const cost = gallons * input.price;
    const nominalCost = nominalGallons * input.price;
    const mpg = miles != null && gallons > 0 ? miles / gallons : null;
    finiteResults([gallons, nominalGallons, cost, nominalCost, ...(mpg == null ? [] : [mpg])]);
    return { tanks: details, gallons, cost, nominalGallons, nominalCost, difference: cost - nominalCost, miles, mpg };
  }

  function estimate({ miles, loadedFraction, baseline, loadedPenalty, emptyPenalty, price }) {
    positive(miles, "Round-trip miles");
    number(loadedFraction, "Loaded fraction", 0, 1);
    positive(baseline, "Baseline MPG");
    number(loadedPenalty, "Loaded MPG penalty");
    number(emptyPenalty, "Empty-trailer MPG penalty");
    number(price, "Price per gallon");
    const loadedMpg = baseline - loadedPenalty;
    const emptyMpg = baseline - emptyPenalty;
    if (loadedMpg <= 0 || emptyMpg <= 0) throw new Error("Both effective MPG values must be above zero. Reduce the penalties or increase baseline MPG.");
    const loadedMiles = miles * loadedFraction;
    const emptyMiles = miles * (1 - loadedFraction);
    const loadedGallons = loadedMiles / loadedMpg;
    const emptyGallons = emptyMiles / emptyMpg;
    const gallons = loadedGallons + emptyGallons;
    const mpg = miles / gallons;
    const cost = gallons * price;
    const quote = Math.ceil(cost / 5) * 5;
    finiteResults([loadedGallons, emptyGallons, gallons, mpg, cost, quote]);
    return { loadedMiles, emptyMiles, loadedMpg, emptyMpg, loadedGallons, emptyGallons, gallons, mpg, cost, quote };
  }

  function fillMpg(start, end, gallons, previousFull, currentFull) {
    if (previousFull !== true || currentFull !== true) throw new Error("Fill-to-fill MPG requires both fills to top off every tank.");
    number(start, "Previous full-fill odometer");
    number(end, "Current full-fill odometer");
    positive(gallons, "Gallons pumped");
    if (end <= start) throw new Error("Current full-fill odometer must exceed the previous reading.");
    const mpg = (end - start) / gallons;
    finiteResults([mpg]);
    return mpg;
  }

  function odometerMiles(start, end) {
    number(start, "Start odometer");
    number(end, "Stop odometer");
    if (end <= start) throw new Error("Stop odometer must be greater than start odometer.");
    return end - start;
  }

  function economy(input) {
    positive(input.baseline, "Normal driving MPG");
    const result = { baseline: input.baseline };
    for (const [key, label] of [["cargoPenalty", "Extra cargo"], ["emptyPenalty", "Empty trailer"], ["towingPenalty", "Loaded trailer"]]) {
      result[key] = number(input[key], `${label} MPG penalty`);
      if (input.baseline - result[key] <= 0) throw new Error(`${label} penalty must be less than normal driving MPG.`);
    }
    return result;
  }

  function trip({ miles, price, economy: input, mix }) {
    positive(miles, "Trip miles");
    number(price, "Job-day fuel price");
    const mpg = economy(input);
    const cargoMiles = number(mix.cargoMiles, "Extra cargo miles");
    const emptyMiles = number(mix.emptyMiles, "Empty trailer miles");
    const towingMiles = number(mix.towingMiles, "Loaded trailer miles");
    const assigned = cargoMiles + emptyMiles + towingMiles;
    const tolerance = Number.EPSILON * Math.max(miles, assigned) * 4;
    if (!Number.isFinite(assigned) || assigned - miles > tolerance) throw new Error("Cargo and trailer miles cannot exceed the total trip miles. Do not count any mile twice.");
    const normalMiles = Math.max(0, miles - assigned);
    const legs = [
      { label: "Normal driving", miles: normalMiles, mpg: mpg.baseline },
      { label: "Extra cargo in vehicle", miles: cargoMiles, mpg: mpg.baseline - mpg.cargoPenalty },
      { label: "Towing empty trailer", miles: emptyMiles, mpg: mpg.baseline - mpg.emptyPenalty },
      { label: "Towing loaded trailer", miles: towingMiles, mpg: mpg.baseline - mpg.towingPenalty }
    ].map(leg => ({ ...leg, gallons: leg.miles / leg.mpg }));
    const gallons = legs.reduce((sum, leg) => sum + leg.gallons, 0);
    const cost = gallons * price;
    const effectiveMpg = miles / gallons;
    const quote = Math.ceil(cost / 5) * 5;
    finiteResults([gallons, cost, effectiveMpg, quote]);
    return { miles, legs, gallons, cost, mpg: effectiveMpg, quote };
  }

  return Object.freeze({ number, positive, decimal, money, calibrateTank, calibrateFill, validateJob, calculateJob, estimate, fillMpg, odometerMiles, economy, trip });
})();
