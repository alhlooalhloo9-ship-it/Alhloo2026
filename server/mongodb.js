"use strict";

const { MongoClient } = require("mongodb");

let clientPromise;

async function getMongoClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const error = new Error("MONGODB_URI is not configured");
    error.statusCode = 503;
    throw error;
  }

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 5
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

async function getDatabase() {
  const client = await getMongoClient();
  const databaseName = process.env.MONGODB_DATABASE;
  if (databaseName) return client.db(databaseName);

  const defaultDb = client.db();
  if (!defaultDb.databaseName) {
    const error = new Error("Set MONGODB_DATABASE or include a database name in MONGODB_URI");
    error.statusCode = 503;
    throw error;
  }
  return defaultDb;
}

module.exports = { getMongoClient, getDatabase };
