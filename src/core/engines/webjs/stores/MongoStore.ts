import * as fs from 'fs';
import { MongoClient, GridFSBucket } from 'mongodb';

export interface MongoStoreOptions {
    mongoose?: any;
    url?: string;
    connection?: any; // Native mongodb connection
}

export class MongoStore {
    private url: string;
    private connection: any;
    private bucket: GridFSBucket;

    constructor({ mongoose, url, connection }: MongoStoreOptions) {
        if (!mongoose && !url && !connection) {
            throw new Error("A valid mongoose instance, url or connection is required for MongoStore.");
        }

        // We will likely init the connection in an init method or lazily if possible, 
        // but RemoteAuth expects the store to be ready or promises to handle it?
        // RemoteAuth doesn't advocate an init method.

        if (url) {
            this.url = url;
            // Native client initialization handled on demand or we need to connect now
            // But constructors cannot be async.
            // We'll lazy connect in the methods.
        }

        // For existing connection support
        if (connection) {
            this.connection = connection;
            this.bucket = new GridFSBucket(this.connection.db());
        }
    }

    // We need a way to ensure connection is open
    private async getConnection() {
        if (this.bucket) return;

        if (this.connection) {
            this.bucket = new GridFSBucket(this.connection.db());
            return;
        }

        if (this.url) {
            const client = new MongoClient(this.url);
            await client.connect();
            this.connection = client;
            this.bucket = new GridFSBucket(this.connection.db());
            return;
        }

        throw new Error("No connection configuration available.");
    }

    async sessionExists(options: { session: string }) {
        await this.getConnection();
        const cursor = this.bucket.find({ filename: `${options.session}.zip` });
        const count = await cursor.count();
        return count > 0;
    }

    async save(options: { session: string }) {
        await this.getConnection();
        const filename = `${options.session}.zip`;

        // Delete previous if exists
        await this.delete(options);

        const stream = fs.createReadStream(filename);
        const uploadStream = this.bucket.openUploadStream(filename);

        return new Promise((resolve, reject) => {
            stream.pipe(uploadStream)
                .on('error', reject)
                .on('finish', resolve);
        });
    }

    async extract(options: { session: string, path: string }) {
        await this.getConnection();
        const filename = `${options.session}.zip`;
        const downloadStream = this.bucket.openDownloadStreamByName(filename);
        const writeStream = fs.createWriteStream(options.path);

        return new Promise((resolve, reject) => {
            downloadStream.pipe(writeStream)
                .on('error', reject)
                .on('finish', resolve);
        });
    }

    async delete(options: { session: string }) {
        await this.getConnection();
        const filename = `${options.session}.zip`;
        const cursor = this.bucket.find({ filename });
        const docs = await cursor.toArray();

        for (const doc of docs) {
            await this.bucket.delete(doc._id);
        }
    }
}
