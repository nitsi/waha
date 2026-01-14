import * as fs from 'fs';
import { MongoClient, Collection, Binary, Db } from 'mongodb';

export interface MongoStoreOptions {
    mongoose?: any;
    url?: string;
    connection?: any; // Native mongodb connection
}

interface SessionDocument {
    id: string;
    zip: Binary;
}

export class MongoStore {
    private url: string;
    private connection: any;
    private db: Db;
    private collection: Collection<SessionDocument>;
    private readonly collectionName = 'waha_sessions';

    constructor({ mongoose, url, connection }: MongoStoreOptions) {
        if (!mongoose && !url && !connection) {
            throw new Error("A valid mongoose instance, url or connection is required for MongoStore.");
        }

        if (url) {
            this.url = url;
        }

        if (connection) {
            this.connection = connection;
        }
    }

    private async getConnection() {
        if (this.collection) return;

        if (this.connection) {
            this.db = this.connection.db();
            this.collection = this.db.collection(this.collectionName);
            return;
        }

        if (this.url) {
            const client = new MongoClient(this.url);
            await client.connect();
            this.connection = client;
            this.db = this.connection.db();
            this.collection = this.db.collection(this.collectionName);
            return;
        }

        throw new Error("No connection configuration available.");
    }

    async sessionExists(options: { session: string }) {
        await this.getConnection();
        const count = await this.collection.countDocuments({ id: options.session });
        return count > 0;
    }

    async save(options: { session: string }) {
        await this.getConnection();
        const filename = `${options.session}.zip`;
        const buffer = await fs.promises.readFile(filename);
        const binary = new Binary(buffer);

        await this.collection.updateOne(
            { id: options.session },
            { $set: { id: options.session, zip: binary } },
            { upsert: true }
        );
    }

    async extract(options: { session: string, path: string }) {
        await this.getConnection();
        const doc = await this.collection.findOne({ id: options.session });

        if (!doc) {
            throw new Error(`Session ${options.session} not found in store.`);
        }

        await fs.promises.writeFile(options.path, doc.zip.buffer);
    }

    async delete(options: { session: string }) {
        await this.getConnection();
        await this.collection.deleteOne({ id: options.session });
    }
}
