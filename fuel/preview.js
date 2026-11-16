"use strict";

(() => {
  const frame = document.querySelector("#calculator-preview");
  const buttons = document.querySelectorAll("[data-width]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      frame.width = button.dataset.width;
      buttons.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      document.querySelector("#preview-status").textContent = `${button.textContent}. Form entries are preserved. Scroll horizontally if needed; the calculator uses the actual selected viewport width.`;
    });
  }
})();
