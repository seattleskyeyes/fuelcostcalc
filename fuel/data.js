"use strict";

const FuelData = (() => {
  const C = FuelCalc;

  function defaults() {
    return {
      version: 2,
      settings: { price: 4, baseline: 16, cargoPenalty: 0, emptyPenalty: 0, towingPenalty: 5, mainNominal: 32, auxNominal: 50, dual: false },
      profiles: [], activeCalibrationId: null, calibrations: [], jobs: []
    };
  }

  function text(value, label, max = 120, allowEmpty = false) {
    if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
      throw new Error(`${label} must be ${allowEmpty ? "" : "nonempty "}text of at most ${max} characters.`);
    }
    return value;
  }

  function object(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value;
  }

  function date(value) {
    text(value, "Date", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error("Enter a valid calendar date.");
    }
    return value;
  }

  const optionalNumber = (value, label) => value === null ? null : C.number(value, label);
  const reference = (value, label) => value === null ? null : text(value, label, 80);

  function metadata(record) {
    object(record, "Record");
    const createdAt = text(record.createdAt, "Creation time", 40);
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid record creation time.");
    return { id: text(record.id, "Record ID", 80), date: date(record.date), createdAt };
  }

  function setup(value) {
    object(value, "Vehicle setup");
    if (typeof value.dual !== "boolean") throw new Error("Two-tank setting must be true or false.");
    return {
      ...C.economy(value), mainNominal: C.positive(value.mainNominal, "Main nominal capacity"),
      auxNominal: C.positive(value.auxNominal, "Auxiliary nominal capacity"), dual: value.dual
    };
  }

  function migrate(input) {
    object(input.settings, "Legacy defaults");
    if (!Array.isArray(input.calibrations) || !Array.isArray(input.jobs)) throw new Error("Legacy backup must contain calibration and job lists.");
    C.estimate({ ...input.settings, miles: 1, loadedFraction: 0.67 });
    return {
      ...input, version: 2, profiles: [],
      settings: { ...input.settings, cargoPenalty: 0, towingPenalty: input.settings.loadedPenalty, dual: false },
      calibrations: input.calibrations.map(fill => ({ ...object(fill, "Legacy fill"), vehicleId: null })),
      jobs: input.jobs.map(job => ({ ...object(job, "Legacy job"), vehicleId: null, vehicleName: "Unassigned (version 1)", method: "gauge", economy: null, mix: null }))
    };
  }

  function index(records, label) {
    const result = new Map(records.map(record => [record.id, record]));
    if (result.size !== records.length) throw new Error(`Duplicate ${label} IDs.`);
    return result;
  }

  function validate(raw) {
    object(raw, "Backup");
    const input = raw.version === 1 ? migrate(raw) : raw;
    if (input.version !== 2) throw new Error("Unsupported backup version. Expected version 1 or 2.");
    if (!Array.isArray(input.profiles) || !Array.isArray(input.calibrations) || !Array.isArray(input.jobs)) throw new Error("Backup must contain profile, calibration, and job lists.");
    object(input.settings, "Defaults");
    const settings = { price: C.number(input.settings.price, "Default price"), ...setup(input.settings) };
    const profiles = input.profiles.map(profile => {
      object(profile, "Vehicle profile");
      return {
        id: text(profile.id, "Vehicle ID", 80), name: text(profile.name, "Vehicle name"),
        ...setup(profile), activeCalibrationId: reference(profile.activeCalibrationId, "Active calibration ID")
      };
    });
    const vehicles = index(profiles, "vehicle");
    function vehicleId(value) {
      const id = reference(value, "Vehicle ID");
      if (id !== null && !vehicles.has(id)) throw new Error("Record references a missing vehicle profile.");
      return id;
    }
    const calibrations = input.calibrations.map(fill => {
      const meta = metadata(fill);
      if (fill.full !== true) throw new Error("Every calibration must represent a full fill of all included tanks.");
      if (!Array.isArray(fill.tanks)) throw new Error("Calibration tank readings are missing.");
      const result = {
        ...meta, vehicleId: vehicleId(fill.vehicleId), price: fill.price,
        receipt: optionalNumber(fill.receipt, "Receipt"), odometer: optionalNumber(fill.odometer, "Odometer"),
        full: true, previousFillId: reference(fill.previousFillId, "Previous fill ID"),
        tanks: fill.tanks.map(tank => {
          object(tank, "Tank reading");
          return { before: tank.before, gallons: tank.gallons, nominal: tank.nominal };
        })
      };
      C.calibrateFill(result);
      return result;
    });
    const fills = index(calibrations, "calibration");
    for (const fill of calibrations) {
      if (fill.previousFillId === null) continue;
      const previous = fills.get(fill.previousFillId);
      if (!previous || previous.id === fill.id) throw new Error("Previous full-fill reference is missing or points to itself.");
      if (previous.vehicleId !== fill.vehicleId) throw new Error("Linked fills must belong to the same vehicle.");
      if (previous.tanks.length !== fill.tanks.length) throw new Error("Linked fills must use the same number of tanks.");
      if (previous.date > fill.date) throw new Error("Previous full fill cannot be dated after the new fill.");
      C.fillMpg(previous.odometer, fill.odometer, C.calibrateFill(fill).gallons, previous.full, fill.full);
    }
    const checked = new Set();
    for (const fill of calibrations) {
      const chain = new Set();
      let current = fill;
      while (current && !checked.has(current.id)) {
        if (chain.has(current.id)) throw new Error("Previous full-fill links form a cycle.");
        chain.add(current.id);
        current = fills.get(current.previousFillId);
      }
      chain.forEach(id => checked.add(id));
    }
    function active(value, id, count) {
      reference(value, "Active calibration ID");
      if (value === null) return;
      const fill = fills.get(value);
      if (!fill || fill.vehicleId !== id || (count && fill.tanks.length !== count)) throw new Error("Active calibration must match its vehicle and tank count.");
    }
    active(input.activeCalibrationId, null);
    profiles.forEach(profile => active(profile.activeCalibrationId, profile.id, profile.dual ? 2 : 1));
    const jobs = input.jobs.map(job => {
      const meta = metadata(job);
      if (!["pending", "final"].includes(job.status)) throw new Error("Job status must be pending or final.");
      if (!["distance", "gauge"].includes(job.method)) throw new Error("Job method must be distance or gauge.");
      if (!Array.isArray(job.tanks)) throw new Error("Job tank readings are missing.");
      const result = {
        ...meta, vehicleId: vehicleId(job.vehicleId), vehicleName: text(job.vehicleName, "Vehicle name"),
        name: text(job.name, "Job name"), notes: text(job.notes, "Notes", 4000, true),
        method: job.method, status: job.status, price: C.number(job.price, "Job-day fuel price"),
        odometerStart: optionalNumber(job.odometerStart, "Start odometer"),
        odometerEnd: optionalNumber(job.odometerEnd, "Stop odometer"),
        calibrationId: reference(job.calibrationId, "Calibration ID"),
        tanks: job.tanks.map(tank => {
          object(tank, "Tank reading");
          return { start: tank.start, end: tank.end };
        }),
        economy: null, mix: null
      };
      if (job.method === "distance") {
        if (job.status !== "final" || job.calibrationId !== null || job.tanks.length) throw new Error("Mileage-based jobs do not use calibrations or pending-fill status.");
        result.economy = C.economy(object(job.economy, "Saved MPG"));
        object(job.mix, "Saved driving mix");
        result.mix = { cargoMiles: job.mix.cargoMiles, emptyMiles: job.mix.emptyMiles, towingMiles: job.mix.towingMiles };
        C.trip({ miles: C.odometerMiles(result.odometerStart, result.odometerEnd), price: result.price, economy: result.economy, mix: result.mix });
      } else {
        C.validateJob(result);
        if (result.calibrationId !== null) {
          const fill = fills.get(result.calibrationId);
          if (!fill || fill.vehicleId !== result.vehicleId) throw new Error("A job's calibration must belong to the same vehicle.");
          C.calculateJob(result, C.calibrateFill(fill));
        } else if (result.status === "final") throw new Error("Final gauge-based jobs must have a calibration.");
      }
      return result;
    });
    index(jobs, "job");
    return { version: 2, settings, profiles, activeCalibrationId: input.activeCalibrationId, calibrations, jobs };
  }

  function finalize(state, fillId, ids) {
    const fill = state.calibrations.find(item => item.id === fillId);
    if (!fill) throw new Error("Choose a saved calibration.");
    const selected = new Set(ids);
    if (!selected.size) throw new Error("Select at least one pending job for this vehicle.");
    const jobs = state.jobs.map(job => {
      if (!selected.delete(job.id)) return job;
      if (job.status !== "pending" || job.method !== "gauge" || job.vehicleId !== fill.vehicleId) throw new Error("Only pending gauge jobs for this vehicle can be finalized.");
      return { ...job, calibrationId: fill.id, status: "final" };
    });
    if (selected.size) throw new Error("A selected job no longer exists.");
    return validate({ ...state, jobs });
  }

  function merge(current, incoming, makeId = () => crypto.randomUUID()) {
    const state = validate(current);
    const source = validate(incoming);
    const types = ["profiles", "calibrations", "jobs"];
    const refs = {
      profiles: [["activeCalibrationId", "calibrations"]],
      calibrations: [["vehicleId", "profiles"], ["previousFillId", "calibrations"]],
      jobs: [["vehicleId", "profiles"], ["calibrationId", "calibrations"]]
    };
    const used = new Set(types.flatMap(type => [...state[type], ...source[type]].map(item => item.id)));
    const uniqueId = () => {
      let id;
      do { id = makeId(); } while (used.has(id));
      used.add(id);
      return id;
    };
    const existing = Object.fromEntries(types.map(type => [type, index(state[type], type)]));
    const maps = Object.fromEntries(types.map(type => [type, new Map(source[type].map(item => {
      const old = existing[type].get(item.id);
      return [item.id, old && JSON.stringify(old) !== JSON.stringify(item) ? uniqueId() : item.id];
    }))]));
    // Profile and active-calibration links form a cycle; propagate ID changes until stable.
    let changed;
    do {
      changed = false;
      for (const type of types) {
        for (const item of source[type]) {
          if (!existing[type].has(item.id) || maps[type].get(item.id) !== item.id) continue;
          if (refs[type].some(([key, target]) => item[key] !== null && maps[target].get(item[key]) !== item[key])) {
            maps[type].set(item.id, uniqueId());
            changed = true;
          }
        }
      }
    } while (changed);
    const result = { ...state };
    for (const type of types) {
      result[type] = [...state[type]];
      for (const item of source[type]) {
        const id = maps[type].get(item.id);
        if (existing[type].has(id)) continue;
        const mapped = { ...item, id };
        for (const [key, target] of refs[type]) mapped[key] = item[key] === null ? null : maps[target].get(item[key]);
        result[type].push(mapped);
      }
    }
    return validate(result);
  }

  return Object.freeze({ defaults, text, date, setup, validate, finalize, merge });
})();
