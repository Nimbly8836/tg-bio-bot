import * as sqlite3 from "sqlite3";
import {User, UserBio} from "../entity/UserBioType";
import {ChatFormat} from "../entity/ChatFormatType";

export default class DbHeller {
    private readonly _db = new sqlite3.Database("storage/bio.db");

    constructor() {
        this.createTable();
    }

    private static createUserTableSql = `
        CREATE TABLE IF NOT EXISTS user
        (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            uid          INTEGER,
            uri          TEXT,
            alias        TEXT,
            is_deleted   BOOLEAN DEFAULT 0,
            bio          TEXT,
            bio_get_time INTEGER,
            create_time  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    private static createUserBioTableSql = `
        CREATE TABLE IF NOT EXISTS user_bio
        (
            user_id     INTEGER NOT NULL,
            bio         TEXT    NOT NULL CHECK (bio <> ''),
            create_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    private static createChatFormatTableSql = `
        CREATE TABLE IF NOT EXISTS chat_format
        (
            chat_id      INTEGER NOT NULL,
            format       TEXT    NOT NULL,
            modify_time  DATETIME DEFAULT CURRENT_TIMESTAMP,
            send_to_chat BOOLEAN DEFAULT 0
        )
    `;

    public batchInsertUsers(users: User[]) {
        const db = this._db;
        db.serialize(() => {
            const stmt = db.prepare("INSERT INTO user (uid, uri, alias, is_deleted, bio, bio_get_time) VALUES (?, ?, ?, ?, ?, ?)");
            users.forEach(user => {
                stmt.run(user.uid, user.uri, user.alias, user.is_deleted, user.bio, user.bio_get_time);
            });
            stmt.finalize();
        });
    }

    public batchInsertUserBios(userBios: UserBio[]) {
        const db = this._db;
        db.serialize(() => {
            const stmt = db.prepare("INSERT INTO user_bio (user_id, bio, create_time) VALUES (?, ?, ?)");
            userBios.forEach(userBio => {
                stmt.run(userBio.user_id, userBio.bio, userBio.create_time);
            });
            stmt.finalize();
        });
    }

    public getUserBioByUserId(userId: number[]): Promise<UserBio[]> {
        return new Promise((resolve, reject) => {
            const placeholders = userId.map(() => '?').join(',');
            this._db.all(`SELECT *
                          FROM user_bio
                          WHERE user_id in (${placeholders})`, userId, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as UserBio[]);
                }
            });
        });
    }

    public batchUpdateUsers(users: User[]) {
        const db = this._db;
        db.serialize(() => {
            users.forEach(user => {
                let updateSql = "UPDATE user SET ";
                let params = [];
                if (user.uid) {
                    updateSql += "uid = ?, ";
                    params.push(user.uid);
                }
                if (user.uri) {
                    updateSql += "uri = ?, ";
                    params.push(user.uri);
                }
                if (user.alias) {
                    updateSql += "alias = ?, ";
                    params.push(user.alias);
                }
                if (user.is_deleted !== undefined) {
                    updateSql += "is_deleted = ?, ";
                    params.push(user.is_deleted);
                }
                if (user.bio) {
                    updateSql += "bio = ?, ";
                    params.push(user.bio);
                }
                if (user.bio_get_time) {
                    updateSql += "bio_get_time = ?, ";
                    params.push(user.bio_get_time);
                }
                if (user.create_time) {
                    updateSql += "create_time = ?, ";
                    params.push(user.create_time);
                }
                updateSql = updateSql.slice(0, -2); // remove last comma
                updateSql += " WHERE id = ?";
                params.push(user.id);
                const stmt = db.prepare(updateSql);
                stmt.run(params);
                stmt.finalize();
            });
        });
    }

    public listAllUsers(): Promise<User[]> {
        return new Promise((resolve, reject) => {
            this._db.all('SELECT * FROM user', (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as User[]);
                }
            });
        });
    }

    public getUserByIds(ids: number[]): Promise<User[]> {
        return new Promise((resolve, reject) => {
            const placeholders = ids.map(() => '?').join(',');
            this._db.all(`SELECT *
                          FROM user
                          WHERE id in (${placeholders})`, ids, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as User[]);
                }
            });
        });
    }

    public getUserByUids(ids: number[]): Promise<User[]> {
        return new Promise((resolve, reject) => {
            const placeholders = ids.map(() => '?').join(',');
            this._db.all(`SELECT *
                          FROM user
                          WHERE uid in (${placeholders})`, ids, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as User[]);
                }
            });
        });
    }

    public insertChatFormat(chatFormat: ChatFormat) {
        this._db.run("INSERT INTO chat_format (chat_id, format, modify_time, send_to_chat) VALUES (?, ?, ?, ?)", chatFormat.chat_id, chatFormat.format, chatFormat.modify_time, chatFormat.send_to_chat);
    }

    public listAllChatFormats(): Promise<ChatFormat[]> {
        return new Promise((resolve, reject) => {
            this._db.all('SELECT * FROM chat_format', (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as ChatFormat[]);
                }
            });
        });
    }

    public getChatFormatByChatId(chatId: number): Promise<ChatFormat> {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM chat_format WHERE chat_id = ?", chatId, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as ChatFormat);
                }
            });
        });
    }

    public updateChatFormat(chatFormat: ChatFormat) {
        let updateSql = "UPDATE chat_format SET ";
        let params = [];
        if (chatFormat.format !== undefined) {
            updateSql += "format = ?, ";
            params.push(chatFormat.format);
        }
        if (chatFormat.modify_time !== undefined) {
            updateSql += "modify_time = ?, ";
            params.push(chatFormat.modify_time);
        }
        if (chatFormat.send_to_chat !== undefined) {
            updateSql += "send_to_chat = ?, ";
            params.push(chatFormat.send_to_chat);
        }
        updateSql = updateSql.slice(0, -2);
        updateSql += " WHERE chat_id = ?";
        params.push(chatFormat.chat_id);
        this._db.run(updateSql, params);
    }

    public getUserByUris(uris: string[]): Promise<User[]> {
        return new Promise((resolve, reject) => {
            const placeholders = uris.map(() => '?').join(',');
            this._db.all(`SELECT *
                          FROM user
                          WHERE uri in (${placeholders})`, uris, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as User[]);
                }
            });
        });
    }

    public createTable() {
        const db = this._db;
        db.serialize(() => {
            db.run(DbHeller.createUserTableSql);
            db.run(DbHeller.createUserBioTableSql);
            db.run(DbHeller.createChatFormatTableSql);
        });
    }
}
