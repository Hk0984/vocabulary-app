import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase/app";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import {
  EmailAuthProvider,
  connectAuthEmulator,
  initializeAuth,
  inMemoryPersistence,
  linkWithCredential,
  signInAnonymously,
  signOut
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
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
const firestorePort = Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':').at(-1));
const authPort = Number((process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099').split(':').at(-1));

if (!projectId.startsWith("demo-")) {
  throw new Error("Rules tests must use a demo-* project ID.");
}

const configuredProject = process.env.GCLOUD_PROJECT;
if (configuredProject && configuredProject !== projectId) {
  throw new Error("Unexpected project ID; refusing to run Rules tests.");
}

const rules = readFileSync(
  new URL("../firestore.improved.rules", import.meta.url),
  "utf8"
);
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

const clientSource = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
function progressClient(database, user = { uid: 'alice', isAnonymous: false }) {
  // Execute the actual client functions in the SDK's realm (plain Firestore objects).
  return new Function('testDb', 'document', 'firebase', 'testUser', clientSource + `
    db = testDb;
    currentUser = testUser;
    selectedSheet = 'English';
    return { loadProgress, recordAnswer, recordHistoryAnswer };
  `)(database, { addEventListener() {}, getElementById() { return null; } }, firebase, user);
}

async function seedDocument(path) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), path), sampleProgress);
  });
}

async function assertAllDocumentOperationsFail(context, path) {
  const ref = doc(context.firestore(), path);

  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, sampleProgress));

  await seedDocument(path);

  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, sampleProgress, { merge: true }));
  await assertFails(updateDoc(ref, "id_7.correct", 2));
  await assertFails(deleteDoc(ref));
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: emulatorHost,
      port: firestorePort,
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

test("Auth Emulator preserves UID when anonymous account is linked to email/password", async () => {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      projectId
    },
    "auth-link-" + randomUUID()
  );
  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence
  });

  connectAuthEmulator(
    auth,
    "http://" + emulatorHost + ":" + authPort,
    { disableWarnings: true }
  );

  const db = getFirestore(app);
  connectFirestoreEmulator(db, emulatorHost, firestorePort);

  try {
    const anonymousCredential = await signInAnonymously(auth);
    const originalUid = anonymousCredential.user.uid;
    const email = "anon-link-" + randomUUID() + "@example.test";
    const password = randomBytes(24).toString("base64url") + "Aa1!";

    const linkedCredential = await linkWithCredential(
      anonymousCredential.user,
      EmailAuthProvider.credential(email, password)
    );

    assert.equal(linkedCredential.user.uid, originalUid);
    assert.equal(linkedCredential.user.isAnonymous, false);

    const ownProgress = doc(
      db,
      "users",
      originalUid,
      "progress",
      "auth-link-check"
    );
    await assertSucceeds(setDoc(ownProgress, sampleProgress));
    assert.equal(
      (await assertSucceeds(getDoc(ownProgress))).exists(),
      true
    );
    await assertSucceeds(deleteDoc(ownProgress));
  } finally {
    await signOut(auth);
    await deleteApp(app);
  }
});

test("email-authenticated owner can read, create, update, list, and delete own progress", async () => {
  const context = testEnv.authenticatedContext("alice", {
    firebase: { sign_in_provider: "password" }
  });
  const ref = doc(context.firestore(), "users/alice/progress/sheet-1");

  await assertSucceeds(setDoc(ref, sampleProgress));
  assert.equal((await assertSucceeds(getDoc(ref))).exists(), true);
  await assertSucceeds(updateDoc(ref, "id_7.correct", 2));
  await assertSucceeds(setDoc(ref, {
    id_7: { wrong: 1 }
  }, { merge: true }));

  const rows = await assertSucceeds(
    getDocs(collection(context.firestore(), "users/alice/progress"))
  );
  assert.equal(rows.size, 1);

  await assertSucceeds(deleteDoc(ref));
  assert.equal((await assertSucceeds(getDoc(ref))).exists(), false);
});

test("a different authenticated user is denied read, create, update, and delete", async () => {
  await seedDocument("users/alice/progress/sheet-1");
  const outsider = testEnv.authenticatedContext("bob", {
    firebase: { sign_in_provider: "password" }
  });

  await assertAllDocumentOperationsFail(
    outsider,
    "users/alice/progress/sheet-1"
  );
  await assertFails(
    getDocs(collection(outsider.firestore(), "users/alice/progress"))
  );
});

test("an unauthenticated user is denied read, create, update, and delete", async () => {
  await seedDocument("users/alice/progress/sheet-1");
  const unauthenticated = testEnv.unauthenticatedContext();

  await assertAllDocumentOperationsFail(
    unauthenticated,
    "users/alice/progress/sheet-1"
  );
  await assertFails(
    getDocs(collection(unauthenticated.firestore(), "users/alice/progress"))
  );
});

test("the /users/{uid} document is denied", async () => {
  const owner = testEnv.authenticatedContext("alice");
  await assertAllDocumentOperationsFail(owner, "users/alice");
  await assertFails(getDocs(collection(owner.firestore(), "users")));
});

test("the /users/{uid}/profile/... path is denied", async () => {
  const owner = testEnv.authenticatedContext("alice");
  await assertAllDocumentOperationsFail(
    owner,
    "users/alice/profile/preferences"
  );
  await assertFails(
    getDocs(collection(owner.firestore(), "users/alice/profile"))
  );
});

test("a subcollection other than progress is denied", async () => {
  const owner = testEnv.authenticatedContext("alice");
  await assertAllDocumentOperationsFail(
    owner,
    "users/alice/settings/preferences"
  );
  await assertFails(
    getDocs(collection(owner.firestore(), "users/alice/settings"))
  );
});

test("an unexpected nested path below progress is denied", async () => {
  const owner = testEnv.authenticatedContext("alice");
  await assertAllDocumentOperationsFail(
    owner,
    "users/alice/progress/sheet-1/attempts/attempt-1"
  );
  await assertFails(
    getDocs(
      collection(
        owner.firestore(),
        "users/alice/progress/sheet-1/attempts"
      )
    )
  );
});

test('actual client transactions preserve concurrent counts, sibling records and genre separation', async () => {
  const firstDb = testEnv.authenticatedContext('alice').firestore();
  const secondDb = testEnv.authenticatedContext('alice').firestore();
  const ref = firstDb.collection('users').doc('alice').collection('progress').doc('English');
  await ref.set({ ...sampleProgress, id_99: {correct:2, wrong:0, total:2} });
  const first = progressClient(firstDb), second = progressClient(secondDb);
  assert.equal(await first.loadProgress(), true);
  assert.equal(await second.loadProgress(), true);
  const word = {id:7, front:'apple', back:'りんご'};
  const answerRepeatedly = async (client, correct) => {
    for (let i = 0; i < 4; i++) await client.recordAnswer(word, correct);
  };
  await Promise.all([answerRepeatedly(first, true), answerRepeatedly(second, false)]);
  const saved = (await ref.get()).data();
  assert.equal(saved.id_7.total, 9);
  assert.equal(saved.id_7.correct, 5);
  assert.equal(saved.id_7.wrong, 4);
  assert.equal(saved.id_99.total, 2);
  assert.deepEqual(Object.keys(saved.id_7).sort(), Object.keys(sampleProgress.id_7).sort());
  await first.recordHistoryAnswer({id:'7', question:'問題', answer:'1', choice1:'正解'}, true);
  const historyRef = firstDb.collection('users').doc('alice').collection('progress').doc('history_questions');
  assert.equal((await historyRef.get()).data().history_7.total, 1);
  assert.equal((await ref.get()).data().id_7.total, 9);
});

test('actual client rejects saving after failed load and creates first history only after successful load', async () => {
  const database = testEnv.authenticatedContext('alice').firestore();
  const ref = database.collection('users').doc('alice').collection('progress').doc('English');
  await ref.set(sampleProgress);
  let transactionCalls = 0;
  const failedClient = progressClient({
    collection() { return {doc() { return {collection() { return {async get() { throw new Error('offline'); }}; }}; }}; },
    runTransaction() { transactionCalls++; }
  });
  assert.equal(await failedClient.loadProgress(), false);
  await assert.rejects(failedClient.recordAnswer({id:7,front:'Q',back:'A'},true), /not ready/);
  assert.equal(transactionCalls, 0);
  assert.equal((await ref.get()).data().id_7.total, 1);
  const fresh = progressClient(database);
  await fresh.loadProgress();
  await fresh.recordAnswer({id:1,front:'new',back:'新規'},true,'NewGenre');
  const created = await database.collection('users').doc('alice').collection('progress').doc('NewGenre').get();
  assert.equal(created.data().id_1.total, 1);
  assert.equal((await ref.get()).data().id_7.total, 1);
});
