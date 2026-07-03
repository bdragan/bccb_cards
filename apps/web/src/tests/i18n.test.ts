import { describe, expect, it } from "vitest";

import { detectLocaleFromLanguageTags, getMessages, locales } from "../i18n";

describe("i18n locale detection", () => {
  it("keeps Croatian next to last before Serbian in the selector order", () => {
    expect(locales).toEqual(["en", "bg", "fr", "hr", "sr"]);
  });

  it.each([
    ["bs-BA"],
    ["sr-RS"],
    ["sr-Latn-ME"],
    ["cnr-ME"],
    ["en-RS"],
    ["en-BA"],
    ["en-ME"],
    ["de-RS"],
    ["de-BA"],
    ["de-ME"],
  ])("defaults %s to Serbian", (languageTag) => {
    expect(detectLocaleFromLanguageTags([languageTag])).toBe("sr");
  });

  it.each([["hr-HR"], ["en-HR"], ["de-HR"]])(
    "defaults %s to Croatian",
    (languageTag) => {
      expect(detectLocaleFromLanguageTags([languageTag])).toBe("hr");
    },
  );

  it.each([["en-FR"], ["de-FR"]])("defaults %s to French", (languageTag) => {
    expect(detectLocaleFromLanguageTags([languageTag])).toBe("fr");
  });

  it.each([["bg-BG"], ["de-BG"]])("defaults %s to Bulgarian", (languageTag) => {
    expect(detectLocaleFromLanguageTags([languageTag])).toBe("bg");
  });

  it("uses supported browser languages", () => {
    expect(detectLocaleFromLanguageTags(["fr-FR"])).toBe("fr");
    expect(detectLocaleFromLanguageTags(["bg-BG"])).toBe("bg");
    expect(detectLocaleFromLanguageTags(["hr-HR"])).toBe("hr");
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
