import test from "node:test";
import assert from "node:assert/strict";
import {
  MELODY_ENABLED_VERSION,
  melodyEnabledForProject,
} from "../src/projectState.js";

test("melody output defaults on for new and legacy projects", () => {
  assert.equal(melodyEnabledForProject(), true);
  assert.equal(melodyEnabledForProject({ melodyEnabled: false }), true);
  assert.equal(
    melodyEnabledForProject({ melodyEnabled: false, melodyEnabledVersion: 0 }),
    true,
  );
});

test("the current project version preserves an intentional melody toggle", () => {
  assert.equal(
    melodyEnabledForProject({ melodyEnabled: true, melodyEnabledVersion: MELODY_ENABLED_VERSION }),
    true,
  );
  assert.equal(
    melodyEnabledForProject({ melodyEnabled: false, melodyEnabledVersion: MELODY_ENABLED_VERSION }),
    false,
  );
});
