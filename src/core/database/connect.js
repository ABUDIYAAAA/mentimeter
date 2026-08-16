import mongoose from "mongoose";

export async function connectMongo(uri) {
  try {
    const connection = await mongoose.connect(uri);

    return [connection, null];
  } catch (error) {
    return [null, error];
  }
}
