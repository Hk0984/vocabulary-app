import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc
} from "firebase/firestore";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";

const projectId = "demo-vocab-app-security";
const emulatorHost = "127.0.0.1";
const emulatorPort = Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':').at(-1));

if (!projectId.startsWith("demo-")) {
  throw new Error("Rules tests must use a demo-* project ID.");
}

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
let testEnv;

const sampleProgress = {
  id_7: {
    correct: 1,
    wrong: 0,
    total: 1,
    front: "sample",
    back: "example",
    id: 7,
    lastAnswered: new Date("2026-01-01T00:00:00.000Z")
  }
};

async function seedProgress(path) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), path), sampleProgress);
  });
}

before(async () => {
  const configuredProject = process.env.GCLOUD_PROJECT;
  if (configuredProject && configuredProject !== projectId) {
    throw new Error("Unexpected project ID; refusing to run Rules tests.");
  }

  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: emulatorHost,
      port: emulatorPort,
      rules
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

test("authenticated owner can read, create, update, and list own progress", async () => {
  const context = testEnv.authenticatedContext("alice");
  const ref = doc(context.firestore(), "users/alice/progress/sheet-1");

  await assertSucceeds(setDoc(ref, sampleProgress));
  const snapshot = await assertSucceeds(getDoc(ref));
  assert.equal(snapshot.exists(), true);

  await assertSucceeds(updateDoc(ref, "id_7.correct", 2));

  const rows = await assertSucceeds(
    getDocs(collection(context.firestore(), "users/alice/progress"))
  );
  assert.equal(rows.size, 1);
});

test("a different authenticated user cannot read, write, or delete owner progress", async () => {
  await seedProgress("users/alice/progress/sheet-1");

  const outsider = testEnv.authenticatedContext("bob");
  const ownerRef = doc(outsider.firestore(), "users/alice/progress/sheet-1");

  await assertFails(getDoc(ownerRef));
  await assertFails(setDoc(ownerRef, sampleProgress, { merge: true }));
  await assertFails(deleteDoc(ownerRef));
});

test("an unauthenticated user cannot read or write progress", async () => {
  await seedProgress("users/alice/progress/sheet-1");

  const unauthenticated = testEnv.unauthenticatedContext();
  const ref = doc(
    unauthenticated.firestore(),
    "users/alice/progress/sheet-1"
  );

  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, sampleProgress));
});

test("an anonymous authenticated user is allowed on own data by current Rules", async () => {
  await seedProgress("users/anonymous-user/progress/sheet-1");

  const anonymous = testEnv.authenticatedContext("anonymous-user", {
    firebase: { sign_in_provider: "anonymous" }
  });
  const ownRef = doc(
    anonymous.firestore(),
    "users/anonymous-user/progress/sheet-1"
  );

  assert.equal((await assertSucceeds(getDoc(ownRef))).exists(), true);
  await assertSucceeds(setDoc(ownRef, sampleProgress, { merge: true }));

  const otherRef = doc(
    anonymous.firestore(),
    "users/alice/progress/sheet-1"
  );
  await assertFails(getDoc(otherRef));
});

test("current Rules allow arbitrary operations and paths under the owner's subtree", async () => {
  const owner = testEnv.authenticatedContext("alice");
  const unexpectedRef = doc(
    owner.firestore(),
    "users/alice/profile/preferences"
  );

  await assertSucceeds(setDoc(unexpectedRef, {
    arbitraryField: { role: "owner", flags: ["unvalidated"] }
  }));
  assert.equal((await assertSucceeds(getDoc(unexpectedRef))).exists(), true);

  const ownProgressRef = doc(
    owner.firestore(),
    "users/alice/progress/sheet-1"
  );
  await assertSucceeds(setDoc(ownProgressRef, sampleProgress));
  await assertSucceeds(deleteDoc(ownProgressRef));
});

test("paths outside users/{uid} are denied", async () => {
  const owner = testEnv.authenticatedContext("alice");
  const ref = doc(owner.firestore(), "admin/flags");

  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, { enabled: true }));
});
