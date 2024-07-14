export type User = {
    id: number,
    uid?: number,
    uri: string,
    // 保存的别名
    alias?: string,
    is_deleted?: boolean | false,
    bio?: string,
    bio_get_time?: number,
    create_time?: number,
}

export type UserBio = {
    user_id: number,
    bio: string,
    create_time: number,
}