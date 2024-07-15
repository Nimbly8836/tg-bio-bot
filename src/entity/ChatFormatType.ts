import BioBot from "../bot/BioBot";

export type ChatFormat = {
    chat_id: number,
    format: string | '用户${name}更新: ${bio}',
    modify_time?: number,
    send_to_chat?: boolean,
}