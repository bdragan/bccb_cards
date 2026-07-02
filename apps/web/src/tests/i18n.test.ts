import { describe, expect, it } from "vitest";

import { detectLocaleFromLanguageTags, getMessages } from "../i18n";

describe("i18n locale detection", () => {
  it.each([
    ["bs-BA"],
    ["sr-RS"],
    ["sr-Latn-ME"],
    ["hr-HR"],
    ["cnr-ME"],
    ["en-RS"],
    ["en-BA"],
    ["en-HR"],
    ["en-ME"],
    ["de-RS"],
    ["de-BA"],
    ["de-HR"],
    ["de-ME"],
  ])("defaults %s to Serbian", (languageTag) => {
    expect(detectLocaleFromLanguageTags([languageTag])).toBe("sr");
  });

  it.each([["en-FR"], ["de-FR"]])("defaults %s to French", (languageTag) => {
    expect(detectLocaleFromLanguageTags([languageTag])).toBe("fr");
  });

  it.each([["bg-BG"], ["de-BG"]])("defaults %s to Bulgarian", (languageTag) => {
    expect(detectLocaleFromLanguageTags([languageTag])).toBe("bg");
  });

  it("uses supported browser languages", () => {
    expect(detectLocaleFromLanguageTags(["fr-FR"])).toBe("fr");
    expect(detectLocaleFromLanguageTags(["bg-BG"])).toBe("bg");
    expect(detectLocaleFromLanguageTags(["en-US"])).toBe("en");
  });

  it("uses the first supported browser language and falls back to English", () => {
    expect(detectLocaleFromLanguageTags(["de-DE", "fr-FR"])).toBe("fr");
    expect(detectLocaleFromLanguageTags(["de-DE"])).toBe("en");
  });

  it("uses Bulgarian marker letters for trump and bonus", () => {
    expect(getMessages("bg").trumpMarker).toBe("К");
    expect(getMessages("bg").bonusMarker).toBe("Б");
  });
});
