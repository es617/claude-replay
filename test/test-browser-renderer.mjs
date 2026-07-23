import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderFromTemplate } from "../src/browser.mjs";
import {
  PACED_WORDING_TUNING,
  PACED_WORDING_TUNING_TEMPLATE_PLACEHOLDER,
} from "../src/reading-rate.mjs";

describe("browser renderer", () => {
  it("injects the shared paced-wording tuning configuration", () => {
    const rendered = renderFromTemplate(PACED_WORDING_TUNING_TEMPLATE_PLACEHOLDER, []);
    assert.equal(rendered, JSON.stringify(PACED_WORDING_TUNING));
  });
});
