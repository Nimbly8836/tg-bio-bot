import BioBot from "../bot/BioBot";

export type ChatFormat = {
    chat_id: number,
    format: string | '用户: ${display_name} Bio: ${bio}',
    modify_time?: number,
    send_to_chat?: boolean,
}