import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { setLocaleForTests } from "../i18n";

beforeEach(() => {
  setLocaleForTests("en");
});

afterEach(() => {
  cleanup();
});
