import mongoose from "mongoose";

export async function connectMongo(uri) {
  try {
    const connection = await mongoose.connect(uri, {
      maxPoolSize: 200,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });

    try {
      const responseCollection = mongoose.connection.collection("responses");
      const indexes = await responseCollection.indexes();
      const legacyIdx = indexes.find(
        (idx) =>
          idx.key &&
          idx.key.sessionId === 1 &&
          idx.key.slideId === 1 &&
          idx.key.participantId === 1 &&
          !idx.key.commandId &&
          idx.unique
      );
      if (legacyIdx) {
        await responseCollection.dropIndex(legacyIdx.name);
      }
    } catch (_) {}

    return [connection, null];
  } catch (error) {
    return [null, error];
  }
}
