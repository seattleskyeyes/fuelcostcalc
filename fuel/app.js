"use strict";

(() => {
  const C = FuelCalc;
  const D = FuelData;
  const { defaults, text, date, validate: validateState } = D;
  const STORAGE_KEY = "fuelcostcalc.v1";
  const $ = selector => document.querySelector(selector);
  const field = (form, name) => form.elements.namedItem(name);
  const estimateForm = $("#estimate-form");
  const jobForm = $("#job-form");
  const calibrationForm = $("#calibration-form");
  const settingsForm = $("#settings-form");
  const profileForm = $("#profile-form");
  let selectedVehicleId = null;
  let quickCalibrations = [];
  let quickActiveId = null;
  let writeBlocked = false;
  let storedSnapshot = null;

  for (const [selector, template] of [["[data-economy-fields]", "#economy-template"], ["[data-mix-fields]", "#mix-template"]]) {
    document.querySelectorAll(selector).forEach(target => target.append($(template).content.cloneNode(true)));
  }
  if (window.self !== window.top) document.body.classList.add("embedded");

  function element(tag, className = "", text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function message(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function storageWarning(value) {
    const warning = $("#storage-warning");
    warning.textContent = value;
    warning.hidden = !value;
  }

  function load() {
    try {
      storedSnapshot = localStorage.getItem(STORAGE_KEY);
      return storedSnapshot === null ? defaults() : validateState(JSON.parse(storedSnapshot));
    } catch (error) {
      writeBlocked = true;
      storageWarning(`Saved data could not be loaded: ${message(error)} Existing data has not been changed. Calculations use temporary defaults; saving is blocked. Export the existing data for recovery, then explicitly replace it with a valid backup or clear it in History / Settings.`);
      return defaults();
    }
  }

  let state = load();
  if (storedSnapshot && !writeBlocked && JSON.parse(storedSnapshot).version === 1) {
    announce("Version 1 data loaded safely. Existing jobs and calibrations remain unassigned, with their original prices. Your next explicit save will upgrade storage to version 2.");
  }

  function commit(candidate, replaceDamaged = false) {
    if (writeBlocked && !replaceDamaged) throw new Error("Saving is blocked to protect unreadable data. Export it, then replace or clear it in History / Settings.");
    const validated = validateState(candidate);
    try {
      if (!replaceDamaged && localStorage.getItem(STORAGE_KEY) !== storedSnapshot) {
        throw new Error("Data changed in another tab. Copy any unsaved readings elsewhere, then reload before saving.");
      }
      const serialized = JSON.stringify(validated);
      localStorage.setItem(STORAGE_KEY, serialized);
      storedSnapshot = serialized;
    } catch (error) {
      storageWarning(`Data was not saved: ${message(error)} Check browser storage permissions or available space. Your last saved data is unchanged.`);
      throw error;
    }
    state = validated;
    writeBlocked = false;
    storageWarning("");
  }

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function freshRecord() {
    return { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  }

  function numeric(form, name, optional = false) {
    const input = field(form, name);
    if (input.value.trim() === "") {
      if (optional) return null;
      throw new Error(`Enter ${name.replace(/([A-Z])/g, " $1").toLowerCase()}.`);
    }
    return C.number(input.valueAsNumber, name);
  }

  function setError(form, error) {
    const target = form.querySelector(".form-error");
    target.hidden = !error;
    target.textContent = error ? message(error) : "";
    if (error) {
      target.tabIndex = -1;
      target.focus();
    }
  }

  function announce(value) {
    $("#app-status").textContent = value;
    $("#app-status").hidden = false;
  }

  function onSubmit(form, action) {
    form.addEventListener("submit", event => {
      event.preventDefault();
      setError(form, null);
      try { action(event); } catch (error) { setError(form, error); }
    });
  }

  function showSection(name, focus = true) {
    for (const section of document.querySelectorAll("main > section")) section.hidden = section.id !== `section-${name}`;
    for (const button of document.querySelectorAll("[data-section]")) {
      if (button.dataset.section === name) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (focus) $(`#${name}-heading`).focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-section]").forEach(button => button.addEventListener("click", () => showSection(button.dataset.section)));

  function sorted(records) {
    return [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  function fillLabel(fill) {
    const active = fill.id === quickActiveId || fill.id === state.activeCalibrationId || state.profiles.some(profile => profile.activeCalibrationId === fill.id);
    return `${fill.date} | ${fill.tanks.length === 1 ? "1 tank" : "2 tanks"} | ${C.decimal(C.calibrateFill(fill).gallons, 3)} gal${active ? " | active" : ""}`;
  }

  function selectedProfile() {
    return state.profiles.find(profile => profile.id === selectedVehicleId);
  }

  function availableFills() {
    return selectedVehicleId ? state.calibrations.filter(fill => fill.vehicleId === selectedVehicleId) : quickCalibrations;
  }

  function fillOptions(select, count, selected, emptyLabel, records = availableFills()) {
    select.replaceChildren(new Option(emptyLabel, ""));
    sorted(records).filter(fill => fill.tanks.length === count).forEach(fill => select.add(new Option(fillLabel(fill), fill.id)));
    select.value = [...select.options].some(option => option.value === selected) ? selected : "";
  }

  function toggleAux(form, id) {
    const dual = field(form, "dual").checked;
    $(id).hidden = !dual;
    $(id).disabled = !dual;
    return dual ? 2 : 1;
  }

  function syncOptions(useActive = false) {
    const activeId = selectedVehicleId ? selectedProfile().activeCalibrationId : quickActiveId;
    const active = availableFills().find(fill => fill.id === activeId);
    if (useActive && active) field(jobForm, "dual").checked = active.tanks.length === 2;
    const jobCount = toggleAux(jobForm, "#job-aux");
    fillOptions(field(jobForm, "calibrationId"), jobCount, useActive ? activeId : field(jobForm, "calibrationId").value, "No calibration yet (pending only)");
    const fillCount = toggleAux(calibrationForm, "#calibration-aux");
    fillOptions(field(calibrationForm, "previousFillId"), fillCount, field(calibrationForm, "previousFillId").value, "Not linked to a previous full fill");
  }

  function syncAuxCapacity(form) {
    const dual = field(form, "dual").checked;
    const capacity = field(form, "auxNominal");
    capacity.required = dual;
    capacity.min = dual ? "0.000001" : "0";
  }

  function putValues(form, values) {
    for (const [key, value] of Object.entries(values)) {
      const input = field(form, key);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    }
    if (form === profileForm || form === settingsForm) syncAuxCapacity(form);
  }

  function economyInput(form) {
    return Object.fromEntries(["baseline", "cargoPenalty", "emptyPenalty", "towingPenalty"].map(key => [key, numeric(form, key)]));
  }

  function mixInput(form) {
    return Object.fromEntries(["cargoMiles", "emptyMiles", "towingMiles"].map(key => [key, numeric(form, key)]));
  }

  function setupInput(form) {
    const dual = field(form, "dual").checked;
    return { ...economyInput(form), mainNominal: numeric(form, "mainNominal"), auxNominal: numeric(form, "auxNominal", !dual), dual };
  }

  function applySetup() {
    const setup = D.setup(selectedProfile() ?? state.settings);
    [estimateForm, jobForm, calibrationForm].forEach(form => putValues(form, setup));
    for (const form of [jobForm, calibrationForm]) field(form, "dual").disabled = !!selectedVehicleId;
    for (const name of ["mainNominal", "auxNominal"]) field(calibrationForm, name).readOnly = !!selectedVehicleId;
    syncOptions(true);
  }

  function renderProfiles() {
    const editing = field(profileForm, "profileId").value;
    $("#vehicle-select").replaceChildren(new Option("Quick calculation (unsaved)", ""));
    field(profileForm, "profileId").replaceChildren(new Option("Create a new vehicle", ""));
    for (const profile of state.profiles) {
      const label = `${profile.name} | ${profile.dual ? "2 tanks" : "1 tank"}`;
      $("#vehicle-select").add(new Option(label, profile.id));
      field(profileForm, "profileId").add(new Option(label, profile.id));
    }
    $("#vehicle-select").value = selectedVehicleId ?? "";
    field(profileForm, "profileId").value = state.profiles.some(profile => profile.id === editing) ? editing : "";
    $("#vehicle-context").textContent = selectedVehicleId
      ? `${selectedProfile().name}: saved vehicle. Its calibrations stay separate from other vehicles. Form MPG overrides do not edit the profile.`
      : "Quick mode: calculations and temporary calibrations stay in this tab only. Reloading discards them; exports contain saved data only.";
    $("#save-job").disabled = !selectedVehicleId;
    $("#job-save-hint").hidden = !!selectedVehicleId;
    $("#use-calibration").textContent = selectedVehicleId ? "Save & use for this vehicle" : "Use for this session";
    $("#clear-quick-calibration").hidden = !!selectedVehicleId;
    $("#calibration-save-hint").textContent = selectedVehicleId
      ? `Saved fills belong to ${selectedProfile().name}. Fill-up prices never change a job's price.`
      : "Quick calibrations are temporary and disappear when this page is reloaded.";
  }

  function loadProfileEditor(id) {
    const profile = state.profiles.find(item => item.id === id);
    putValues(profileForm, profile ?? { ...state.settings, name: "" });
    field(profileForm, "profileId").value = id;
    setError(profileForm, null);
  }

  function selectVehicle(id) {
    selectedVehicleId = id || null;
    for (const key of ["mainStart", "mainEnd", "auxStart", "auxEnd"]) field(jobForm, key).value = "";
    for (const key of ["mainBefore", "mainGallons", "auxBefore", "auxGallons", "receipt", "odometer", "previousFillId"]) field(calibrationForm, key).value = "";
    field(calibrationForm, "full").checked = false;
    applySetup();
    renderProfiles();
    renderCalibrations();
    $("#pending-prompt").hidden = true;
    for (const id of ["#estimate-result", "#job-result", "#calibration-result"]) invalidate($(id));
    [estimateForm, jobForm, calibrationForm].forEach(form => setError(form, null));
  }

  $("#vehicle-select").addEventListener("change", event => selectVehicle(event.target.value));
  $("#manage-vehicles").addEventListener("click", () => {
    showSection("data");
    loadProfileEditor(selectedVehicleId ?? "");
    profileForm.scrollIntoView({ block: "start" });
    field(profileForm, "name").focus({ preventScroll: true });
  });
  field(profileForm, "profileId").addEventListener("change", event => loadProfileEditor(event.target.value));
  for (const form of [profileForm, settingsForm]) {
    field(form, "dual").addEventListener("change", () => syncAuxCapacity(form));
  }
  onSubmit(profileForm, () => {
    const id = field(profileForm, "profileId").value || crypto.randomUUID();
    const old = state.profiles.find(profile => profile.id === id);
    const setup = setupInput(profileForm);
    const active = state.calibrations.find(fill => fill.id === old?.activeCalibrationId);
    const profile = {
      id, name: text(field(profileForm, "name").value.trim(), "Vehicle name"), ...setup,
      activeCalibrationId: active?.tanks.length === (setup.dual ? 2 : 1) ? active.id : null
    };
    commit({ ...state, profiles: old ? state.profiles.map(item => item.id === id ? profile : item) : [...state.profiles, profile] });
    selectVehicle(id);
    loadProfileEditor(id);
    announce(`Saved vehicle "${profile.name}". Existing job MPG, tank calculations, and job-day prices are unchanged.`);
  });

  function details(title, rows, formula) {
    const disclosure = element("details");
    disclosure.append(element("summary", "", title));
    if (rows.length) {
      const list = element("dl");
      for (const [label, value] of rows) {
        const row = element("div");
        row.append(element("dt", "", label), element("dd", "", value));
        list.append(row);
      }
      disclosure.append(list);
    }
    if (formula) disclosure.append(element("code", "", formula));
    return disclosure;
  }

  function resultCard(target, title, result, gallonPlaces = 2) {
    target.replaceChildren(element("p", "eyebrow", title));
    const numbers = element("div", "result-numbers");
    const gallons = element("div", "result-gallons", C.decimal(result.gallons, gallonPlaces));
    gallons.append(element("span", "", " US gal"));
    numbers.append(element("strong", "result-money", C.money(result.cost)), gallons);
    target.append(numbers);
  }

  function warning(target, value) {
    target.append(element("p", "notice warning", value));
  }

  function tankName(index) {
    return index === 0 ? "Main / only tank" : "Auxiliary tank";
  }

  function invalidate(target) {
    target.replaceChildren(element("p", "eyebrow", "READY WHEN YOU ARE"), element("p", "", "Inputs changed. Calculate again to see an updated result."));
  }

  for (const [form, target] of [[estimateForm, "#estimate-result"], [jobForm, "#job-result"], [calibrationForm, "#calibration-result"]]) {
    form.addEventListener("input", () => {
      invalidate($(target));
      setError(form, null);
    });
  }
  field(jobForm, "dual").addEventListener("change", () => syncOptions());
  field(calibrationForm, "dual").addEventListener("change", () => syncOptions());

  function updateMileage() {
    const gauge = field(jobForm, "method").value === "gauge";
    $("#job-mileage").hidden = gauge;
    $("#job-mileage").disabled = gauge;
    $("#job-gauges").hidden = !gauge;
    $("#job-gauges").disabled = !gauge;
    field(jobForm, "odometerStart").required = !gauge;
    field(jobForm, "odometerEnd").required = !gauge;
    for (const form of [estimateForm, jobForm]) {
      const summary = form.querySelector(".mix-summary");
      try {
        const miles = form === estimateForm ? numeric(form, "miles") : C.odometerMiles(numeric(form, "odometerStart"), numeric(form, "odometerEnd"));
        if (form === jobForm) $("#job-distance").textContent = `${C.decimal(miles)} miles driven (stop minus start).`;
        const assigned = Object.values(mixInput(form)).reduce((sum, value) => sum + value, 0);
        summary.textContent = assigned > miles + Number.EPSILON * miles * 4
          ? "Assigned miles exceed the trip. Count each mile once."
          : `Normal driving: ${C.decimal(Math.max(0, miles - assigned))} miles.`;
      } catch (error) {
        summary.textContent = message(error);
        if (form === jobForm) $("#job-distance").textContent = `Trip mileage: ${message(error)}`;
      }
    }
  }
  estimateForm.addEventListener("input", updateMileage);
  jobForm.addEventListener("input", updateMileage);
  field(jobForm, "method").addEventListener("change", updateMileage);

  function appendTripDetails(target, result) {
    target.append(details("Driving mix & fuel breakdown", result.legs.map(leg => [
      leg.label, `${C.decimal(leg.miles)} mi / ${C.decimal(leg.mpg)} MPG = ${C.decimal(leg.gallons)} gal`
    ])));
    target.append(details("How this was calculated", [],
      "Normal miles = total miles - cargo miles - empty-trailer miles - loaded-trailer miles. Each mode's MPG = normal driving MPG minus that mode's own penalty. Penalties never stack. Gallons = sum of each mode's miles / MPG. Cost = gallons x the job-day price. MPG and fuel are estimates, even when miles come from odometers."));
  }

  onSubmit(estimateForm, () => {
    const input = {
      miles: numeric(estimateForm, "miles"), economy: economyInput(estimateForm),
      mix: mixInput(estimateForm), price: numeric(estimateForm, "price")
    };
    const result = C.trip(input);
    const target = $("#estimate-result");
    resultCard(target, "ESTIMATED FUEL COST", result);
    target.append(element("p", "", `Effective ${C.decimal(result.mpg)} MPG | Suggested fuel quote ${C.money(result.quote)}`));
    target.append(element("p", "hint", `${date(field(estimateForm, "date").value)} | Job-day price $${C.decimal(input.price, 3)}/gal. Quote rounds fuel cost up to $5.`));
    appendTripDetails(target, result);
  });

  function jobInput(saving) {
    if (saving && !selectedVehicleId) throw new Error("Choose or create a saved vehicle before saving a job.");
    const method = field(jobForm, "method").value;
    const tanks = [];
    if (method === "gauge") {
      tanks.push({ start: numeric(jobForm, "mainStart"), end: numeric(jobForm, "mainEnd") });
      if (field(jobForm, "dual").checked) tanks.push({ start: numeric(jobForm, "auxStart"), end: numeric(jobForm, "auxEnd") });
    }
    const input = {
      vehicleId: selectedVehicleId, vehicleName: selectedProfile()?.name ?? "Quick calculation",
      method, name: saving ? text(field(jobForm, "name").value.trim(), "Job name") : field(jobForm, "name").value.trim() || "Quick job",
      date: date(field(jobForm, "date").value), tanks, price: numeric(jobForm, "price"),
      notes: field(jobForm, "notes").value, odometerStart: numeric(jobForm, "odometerStart", true),
      odometerEnd: numeric(jobForm, "odometerEnd", true),
      calibrationId: method === "gauge" ? field(jobForm, "calibrationId").value || null : null,
      status: method === "gauge" && field(jobForm, "pending").checked ? "pending" : "final",
      economy: method === "distance" ? economyInput(jobForm) : null,
      mix: method === "distance" ? mixInput(jobForm) : null
    };
    if (method === "gauge") {
      C.validateJob(input);
      if (!input.calibrationId && input.status === "final") throw new Error("Choose a calibration, or mark this job Pending next fill.");
    } else {
      C.trip({ miles: C.odometerMiles(input.odometerStart, input.odometerEnd), ...input });
    }
    return input;
  }

  function jobResult(job) {
    if (job.method === "distance") return C.trip({ miles: C.odometerMiles(job.odometerStart, job.odometerEnd), ...job });
    const fill = [...state.calibrations, ...quickCalibrations].find(item => item.id === job.calibrationId && item.vehicleId === job.vehicleId);
    return fill ? C.calculateJob(job, C.calibrateFill(fill)) : null;
  }

  function appendJobDetails(target, job, result) {
    if (job.method === "distance") {
      target.append(element("p", "hint", `${C.decimal(result.miles)} actual miles | ${C.decimal(result.mpg)} estimated MPG. Fuel use is estimated from your saved MPG inputs, not measured at the pump.`));
      appendTripDetails(target, result);
      return;
    }
    result.tanks.forEach((tank, index) => {
      if (tank.extrapolated) warning(target, `${tankName(index)}: Job range is outside the calibrated band. Log the next fill-up and recalculate with that calibration.`);
    });
    const rows = result.tanks.map((tank, index) => [tankName(index), `${C.decimal(tank.gallons)} gal`]);
    rows.push(["Nominal capacity method (less accurate)", `${C.decimal(result.nominalGallons)} gal | ${C.money(result.nominalCost)}`]);
    rows.push(["Calibrated minus nominal cost", C.money(result.difference)]);
    if (result.miles !== null) {
      rows.push(["Distance", `${C.decimal(result.miles)} mi`]);
      rows.push(["Segment MPG, assumes gauge burn is accurate", result.mpg === null ? "Unavailable: no measured burn" : `${C.decimal(result.mpg)} MPG`]);
    }
    target.append(details("Fuel breakdown & comparison", rows));
    target.append(details("How this was calculated", [],
      "Each tank: (start % - end %) x calibrated gallons per %. Cost = sum of tank gallons x this job's job-day price, not its calibration's refill price. Nominal comparison = sum of (gauge drop / 100 x nominal capacity). Dollar difference is calculated before rounding, so it may differ by a cent from subtracting the displayed totals."));
  }

  function renderJobResult(job) {
    const target = $("#job-result");
    const result = jobResult(job);
    if (!result) {
      target.replaceChildren(element("p", "eyebrow", "PENDING NEXT FILL"), element("h3", "", "Readings ready. Cost not yet known."), element("p", "", "For a saved vehicle, save this job and finalize after its next fill. Quick mode can use a temporary calibration without saving."));
      return;
    }
    resultCard(target, job.method === "distance" ? "ESTIMATED FUEL | ACTUAL MILES" : job.status === "pending" ? "PROVISIONAL FUEL COST" : "CALIBRATED FUEL COST", result);
    target.append(element("p", "", `${job.name} | ${job.date} | Job-day price $${C.decimal(job.price, 3)}/gal`));
    appendJobDetails(target, job, result);
  }

  onSubmit(jobForm, event => {
    const saving = event.submitter?.value === "save";
    const job = jobInput(saving);
    renderJobResult(job);
    if (!saving) return;
    commit({ ...state, jobs: [...state.jobs, { ...freshRecord(), ...job }] });
    renderHistory();
    announce(`Saved "${job.name}" as ${job.status === "pending" ? "pending next fill" : "final"}.`);
    for (const key of ["name", "mainStart", "mainEnd", "auxStart", "auxEnd", "odometerStart", "odometerEnd", "notes"]) field(jobForm, key).value = "";
    putValues(jobForm, { cargoMiles: 0, emptyMiles: 0, towingMiles: 0 });
    updateMileage();
  });

  function calibrationInput() {
    const tanks = [{ before: numeric(calibrationForm, "mainBefore"), gallons: numeric(calibrationForm, "mainGallons"), nominal: numeric(calibrationForm, "mainNominal") }];
    if (field(calibrationForm, "dual").checked) tanks.push({ before: numeric(calibrationForm, "auxBefore"), gallons: numeric(calibrationForm, "auxGallons"), nominal: numeric(calibrationForm, "auxNominal") });
    if (!field(calibrationForm, "full").checked) throw new Error("Confirm that every included tank was filled to 100%.");
    return {
      ...freshRecord(), vehicleId: selectedVehicleId, date: date(field(calibrationForm, "date").value), tanks,
      price: numeric(calibrationForm, "price"), receipt: numeric(calibrationForm, "receipt", true),
      odometer: numeric(calibrationForm, "odometer", true), full: true,
      previousFillId: field(calibrationForm, "previousFillId").value || null
    };
  }

  function appendCalibrationDetails(target, fill, result) {
    result.tanks.forEach((tank, index) => {
      if (tank.mismatch) warning(target, `${tankName(index)}: Gauge does not map linearly to nominal capacity. Calibration still valid within its band.`);
    });
    if (result.receiptMismatch) warning(target, "Computed fuel cost differs from the receipt by more than $0.05. Check for a possible data-entry error.");
    const rows = result.tanks.flatMap((tank, index) => [
      [tankName(index), `${C.decimal(tank.rate, 6)} gal/%`],
      ["Implied / nominal capacity", `${C.decimal(tank.capacity, 3)} / ${C.decimal(tank.nominal, 3)} gal`],
      ["Calibrated band", `${tank.before} to 100%`]
    ]);
    rows.push(["Total pumped", `${C.decimal(result.gallons, 3)} gal`]);
    if (fill.previousFillId) {
      const previous = [...state.calibrations, ...quickCalibrations].find(item => item.id === fill.previousFillId);
      rows.push(["Fill-to-fill MPG", `${C.decimal(C.fillMpg(previous.odometer, fill.odometer, result.gallons, previous.full, fill.full))} MPG`]);
    }
    target.append(details("Calibration details", rows));
    target.append(details("How this was calculated", [],
      "Rate = gallons pumped / (100 - gauge % before fill). Implied full capacity = rate x 100. This linear approximation applies within the measured band. Fill-to-fill MPG = odometer difference / current gallons pumped, only for linked consecutive full fills of the same vehicle."));
  }

  onSubmit(calibrationForm, event => {
    const fill = calibrationInput();
    const candidate = {
      ...state, calibrations: [...state.calibrations, ...(selectedVehicleId ? [] : quickCalibrations), fill],
      profiles: state.profiles.map(profile => profile.id === selectedVehicleId ? { ...profile, activeCalibrationId: fill.id } : profile)
    };
    validateState(candidate);
    const result = C.calibrateFill(fill);
    const target = $("#calibration-result");
    resultCard(target, "FULL-FILL CALIBRATION", result, 3);
    appendCalibrationDetails(target, fill, result);
    if (event.submitter?.value === "calculate") return;
    if (selectedVehicleId) commit(candidate);
    else {
      quickCalibrations.push(fill);
      quickActiveId = fill.id;
    }
    syncOptions(true);
    invalidate($("#job-result"));
    renderCalibrations();
    if (selectedVehicleId) renderPendingPrompt(fill);
    announce(selectedVehicleId ? "Calibration saved for this vehicle. Pending jobs keep their original job-day fuel prices." : "Temporary calibration ready for quick gauge actuals. Nothing was saved to browser storage.");
    for (const key of ["mainBefore", "mainGallons", "auxBefore", "auxGallons", "receipt", "odometer"]) field(calibrationForm, key).value = "";
    field(calibrationForm, "full").checked = false;
    field(calibrationForm, "previousFillId").value = "";
  });

  function renderCalibrations() {
    const target = $("#calibration-list");
    target.replaceChildren();
    const records = selectedVehicleId ? availableFills() : [...quickCalibrations, ...state.calibrations.filter(fill => fill.vehicleId === null)];
    $("#calibration-list-heading").textContent = selectedVehicleId ? `${selectedProfile().name}: saved calibrations` : "Quick calibrations / legacy unassigned fills";
    if (!records.length) target.append(element("p", "empty-state", "No calibrations for this vehicle yet. Mileage estimates work without one. Add a full fill above for gauge actuals."));
    for (const fill of sorted(records)) {
      const temporary = quickCalibrations.some(item => item.id === fill.id);
      const result = C.calibrateFill(fill);
      const card = element("article", "panel");
      const header = element("div", "record-top");
      header.append(element("h3", "", fillLabel(fill)), element("span", "record-cost", C.money(result.cost)));
      card.append(header);
      card.append(element("p", "hint", temporary ? "Temporary: this tab only" : fill.vehicleId ? selectedProfile().name : "Saved unassigned fill from an earlier version. Available to its existing unassigned jobs in history."));
      if (fill.odometer !== null) card.append(element("p", "hint", `Odometer: ${fill.odometer} mi`));
      appendCalibrationDetails(card, fill, result);
      const activeId = selectedVehicleId ? selectedProfile().activeCalibrationId : quickActiveId;
      if ((temporary || selectedVehicleId) && fill.id !== activeId && fill.tanks.length === (field(calibrationForm, "dual").checked ? 2 : 1)) {
        const button = element("button", "", "Make active");
        button.type = "button";
        const errorTarget = element("p", "form-error");
        errorTarget.hidden = true;
        button.addEventListener("click", () => {
          try {
            if (temporary) quickActiveId = fill.id;
            else commit({ ...state, profiles: state.profiles.map(profile => profile.id === fill.vehicleId ? { ...profile, activeCalibrationId: fill.id } : profile) });
            syncOptions(true);
            invalidate($("#job-result"));
            renderCalibrations();
            announce(temporary ? "Temporary calibration selected. No browser data was saved." : "This vehicle's active calibration changed. Job-day prices were not changed.");
          } catch (error) {
            errorTarget.textContent = message(error);
            errorTarget.hidden = false;
          }
        });
        card.append(button, errorTarget);
      }
      target.append(card);
    }
  }

  function renderPendingPrompt(fill) {
    const target = $("#pending-prompt");
    const pending = state.jobs.filter(job => job.status === "pending" && job.vehicleId === fill.vehicleId && job.tanks.length === fill.tanks.length);
    target.replaceChildren();
    target.hidden = pending.length === 0;
    if (!pending.length) return;
    target.append(element("h3", "", "Finalize pending jobs for this vehicle?"), element("p", "hint", "Only this vehicle's compatible jobs are listed. Their saved job-day prices will be preserved. No jobs are selected automatically."));
    const form = element("form");
    for (const job of pending) {
      const label = element("label", "check");
      const input = element("input");
      input.type = "checkbox";
      input.name = "jobId";
      input.value = job.id;
      label.append(input, document.createTextNode(`${job.date}: ${job.name}`));
      form.append(label);
    }
    const errorTarget = element("p", "form-error");
    errorTarget.hidden = true;
    errorTarget.setAttribute("role", "alert");
    const button = element("button", "primary", "Finalize selected jobs");
    button.type = "submit";
    form.append(errorTarget, button);
    onSubmit(form, () => {
      const ids = new Set(new FormData(form).getAll("jobId"));
      commit(D.finalize(state, fill.id, ids));
      renderHistory();
      target.hidden = true;
      announce(`Finalized ${ids.size} job(s), keeping their job-day prices. Check history for costs and any calibration-band warnings.`);
    });
    target.append(form);
  }

  $("#clear-quick-calibration").addEventListener("click", () => {
    quickCalibrations = [];
    quickActiveId = null;
    syncOptions(true);
    renderCalibrations();
    invalidate($("#job-result"));
    invalidate($("#calibration-result"));
    announce("Temporary calibrations cleared. Saved vehicles, fills, and jobs were not changed.");
  });

  function renderHistory() {
    const target = $("#job-list");
    target.replaceChildren();
    const finalCount = state.jobs.filter(job => job.status === "final").length;
    const summary = $("#history-summary");
    summary.replaceChildren(element("p", "eyebrow", "SAVED JOBS"), element("h3", "", `${finalCount} final | ${state.jobs.length - finalCount} pending next fill`), element("p", "", "All vehicles. Jobs keep their own job-day prices and original MPG inputs or calibration. Mileage-based fuel use is estimated, not measured."));
    if (!state.jobs.length) target.append(element("p", "empty-state", "Your logbook is empty. Save a job from Job actuals to keep its readings and fuel cost here."));
    for (const job of sorted(state.jobs)) {
      const result = jobResult(job);
      const card = element("article", "panel");
      const header = element("div", "record-top");
      header.append(element("h3", "", job.name), element("span", "record-cost", result ? C.money(result.cost) : "Awaiting fill"));
      card.append(header, element("span", `badge ${job.status}`, job.status === "pending" ? "Pending next fill" : job.method === "distance" ? "Final: estimated fuel" : "Final: gauge-based"));
      card.append(element("p", "hint", `${job.vehicleName} | ${job.date} | ${result ? `${C.decimal(result.gallons)} gal${job.status === "pending" ? " (provisional)" : ""}` : "Gallons not yet known"} | Job-day price $${C.decimal(job.price, 3)}/gal`));
      if (result) appendJobDetails(card, job, result);
      const readings = job.tanks.map((tank, index) => [tankName(index), `${tank.start}% to ${tank.end}%`]);
      if (job.odometerStart !== null) readings.push(["Odometer", `${job.odometerStart} to ${job.odometerEnd} mi`]);
      if (job.method === "gauge") readings.push(["Calibration", job.calibrationId ? fillLabel(state.calibrations.find(fill => fill.id === job.calibrationId)) : "None"]);
      if (job.notes) readings.push(["Notes", job.notes]);
      card.append(details("Saved readings & notes", readings));
      const edit = element("details");
      edit.append(element("summary", "", job.status === "pending" ? "Recalculate & finalize" : job.method === "distance" ? "Correct job-day price" : "Update job-day price or calibration"));
      const form = element("form", "record-inputs");
      const fields = element("div", "fields");
      const priceLabel = element("label", "", "Fuel price on this job's date ($/US gal)");
      const price = element("input");
      Object.assign(price, { type: "number", name: "price", min: "0", step: "any", inputMode: "decimal", required: true, value: job.price });
      priceLabel.append(price);
      const calibrationLabel = element("label", "", "Calibration for this vehicle");
      const select = element("select");
      select.name = "calibrationId";
      select.required = true;
      fillOptions(select, job.tanks.length, job.calibrationId, "Choose a full-fill calibration", state.calibrations.filter(fill => fill.vehicleId === job.vehicleId));
      calibrationLabel.append(select);
      fields.append(priceLabel);
      if (job.method === "gauge") fields.append(calibrationLabel);
      const errorTarget = element("p", "form-error");
      errorTarget.hidden = true;
      errorTarget.setAttribute("role", "alert");
      const button = element("button", "primary", job.status === "pending" ? "Recalculate & mark final" : "Update cost");
      button.type = "submit";
      form.append(fields, element("p", "hint", "Use the fuel price for this job's date, even if a later fill-up cost more or less. Saved MPG inputs do not change when a profile is edited."), errorTarget, button);
      onSubmit(form, () => {
        const updated = { ...job, price: numeric(form, "price"), calibrationId: job.method === "gauge" ? select.value : null, status: "final" };
        commit({ ...state, jobs: state.jobs.map(item => item.id === job.id ? updated : item) });
        renderHistory();
        $("#pending-prompt").hidden = true;
        announce(`Updated "${job.name}". Its job-day fuel price stays independent of refill prices.`);
      });
      edit.append(form);
      card.append(edit);
      target.append(card);
    }
  }

  onSubmit(settingsForm, () => {
    const settings = { price: numeric(settingsForm, "price"), ...setupInput(settingsForm) };
    commit({ ...state, settings });
    if (!selectedVehicleId) applySetup();
    for (const id of ["#estimate-result", "#job-result", "#calibration-result"]) invalidate($(id));
    announce("Quick defaults saved. Saved profiles, history, and entered job-day prices are unchanged.");
  });

  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
    const link = element("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("#export-data").addEventListener("click", () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (writeBlocked) {
        if (raw === null) throw new Error("No saved data could be read for export. Check browser storage permissions.");
        download(raw, `fuel-recovery-${today()}.json`);
        announce("Downloaded unreadable saved data for recovery. This is not a validated backup.");
      } else {
        if (raw !== storedSnapshot) throw new Error("Saved data changed in another tab. Reload before exporting.");
        download(JSON.stringify(state, null, 2), `fuel-backup-${today()}.json`);
        announce("Backup downloaded. It includes saved vehicles, jobs, calibrations, and defaults. Quick calculations, temporary calibrations, and unsaved form entries are excluded.");
      }
    } catch (error) {
      storageWarning(`Export failed: ${message(error)}`);
    }
  });

  $("#import-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setError(form, null);
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const file = field(form, "file").files[0];
      if (!file) throw new Error("Choose a JSON backup.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Backup is too large. The import limit is 5 MB.");
      const mode = field(form, "mode").value;
      if (!field(form, "confirm").checked) throw new Error("Confirm the selected import action.");
      const incoming = validateState(JSON.parse(await file.text()));
      commit(mode === "replace" ? incoming : D.merge(state, incoming), mode === "replace" && writeBlocked);
      resetForms();
      renderAll();
      announce(`Backup ${mode === "replace" ? "replaced this device's data" : "merged successfully"}.`);
      form.reset();
    } catch (error) {
      setError(form, new Error(`Import failed. Existing data was not replaced: ${message(error)}`));
    } finally {
      button.disabled = false;
    }
  });

  onSubmit($("#clear-form"), () => {
    if (field($("#clear-form"), "confirmation").value !== "CLEAR") throw new Error("Type CLEAR exactly to delete all calculator data.");
    commit(defaults(), true);
    resetForms();
    renderAll();
    $("#clear-form").reset();
    announce("All calculator data has been cleared from this device.");
  });

  function resetForms(clearResults = true) {
    selectedVehicleId = null;
    quickCalibrations = [];
    quickActiveId = null;
    [estimateForm, jobForm, calibrationForm, settingsForm, profileForm].forEach(form => {
      form.reset();
      setError(form, null);
    });
    for (const form of [estimateForm, jobForm, calibrationForm]) field(form, "date").value = today();
    field(estimateForm, "price").value = state.settings.price;
    field(calibrationForm, "price").value = state.settings.price;
    putValues(settingsForm, state.settings);
    renderProfiles();
    loadProfileEditor("");
    applySetup();
    updateMileage();
    if (clearResults) for (const id of ["#estimate-result", "#job-result", "#calibration-result"]) invalidate($(id));
    $("#pending-prompt").hidden = true;
  }

  function renderAll() {
    renderCalibrations();
    renderHistory();
  }

  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY || event.key === null) storageWarning("Calculator data changed in another tab. Reload before saving or exporting. Unsaved form entries will be lost on reload.");
  });

  resetForms(false);
  renderAll();
})();
