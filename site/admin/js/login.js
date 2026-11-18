import { api } from "./api.js";

const form = document.getElementById("login-form");
const errorBox = document.getElementById("login-error");
const show = document.getElementById("show-password");
const password = document.getElementById("password");

show.addEventListener("change", () => {
  password.type = show.checked ? "text" : "password";
});

function safeNext() {
  const next = new URLSearchParams(window.location.search).get("next") || "#/dashboard";
  return /^#\/[\w/-]*$/.test(next) ? next : "#/dashboard";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const username = form.username.value.trim();
  const pw = form.password.value;
  for (const input of [form.username, form.password]) input.removeAttribute("aria-invalid");
  if (!username || !pw) {
    errorBox.textContent = "Enter both your username and password.";
    errorBox.hidden = false;
    (!username ? form.username : form.password).setAttribute("aria-invalid", "true");
    (!username ? form.username : form.password).focus();
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    await api("POST", "/auth/login", { username, password: pw });
    window.location.assign(`/admin${safeNext()}`);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
    form.password.setAttribute("aria-invalid", "true");
    form.password.focus();
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});
