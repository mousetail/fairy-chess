import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashForRoute,
  routeFromHash,
  type Route,
} from "../src/router.ts";

/** A game identifier of the shape the server hands out. */
const gameId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("each named page has a route", () => {
  assert.deepEqual(routeFromHash(""), { kind: "home" });
  assert.deepEqual(routeFromHash("#"), { kind: "home" });
  assert.deepEqual(routeFromHash("#discoveries"), { kind: "discoveries" });
  assert.deepEqual(routeFromHash("#history"), { kind: "history" });
});

test("a game's UUID names the game", () => {
  assert.deepEqual(routeFromHash(`#${gameId}`), { kind: "game", gameId });
});

test("the older link that spells out the game is still read", () => {
  assert.deepEqual(routeFromHash(`#/game/${gameId}`), { kind: "game", gameId });
});

test("a fragment that names no page falls back to the home page", () => {
  // A fragment of the shape a player identifier takes is read as a game, so
  // only one that could never be an identifier falls back to the home page.
  for (const hash of ["#nonsense!", "#/game/not a uuid", "#two words"]) {
    assert.deepEqual(routeFromHash(hash), { kind: "home" }, hash);
  }
});

test("a route names the fragment it came from", () => {
  assert.equal(hashForRoute({ kind: "home" }), "");
  assert.equal(hashForRoute({ kind: "discoveries" }), "#discoveries");
  assert.equal(hashForRoute({ kind: "history" }), "#history");
  assert.equal(hashForRoute({ kind: "game", gameId }), `#${gameId}`);
});

test("reading a fragment and writing it back leaves it as it was", () => {
  for (const hash of ["", "#discoveries", "#history", `#${gameId}`]) {
    const route: Route = routeFromHash(hash);
    assert.equal(hashForRoute(route), hash);
  }
});
