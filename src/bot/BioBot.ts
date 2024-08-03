// @ts-ignore
import dotenv from 'dotenv'
import {User, UserBio} from "../entity/UserBioType";
import {session, Telegraf} from "telegraf";
import * as cheerio from 'cheerio'
import DbHeller from "../db/DbHeller";

dotenv.config()

export default class BioBot {
    private _token: string
    private _bot: Telegraf
    static TG_AT_START = '@'
    static TG_AT_PREFIX = 'https://t.me/'
    static DEFAULT_FORMAT = '用户:${display_name} Bio: ${bio}'
    static $ALIAS = '${alias}'
    static $NAME = '${name}'
    static $BIO = '${bio}'
    static $TIME = '${time}'
    static $DISPLAY_NAME = '${display_name}'
    static ALIAS_SPLIT = '::'
    static BATCH_SIZE = 6;
    private dbHeller: DbHeller = new DbHeller()
    private tmp_current_bios: UserBio[] = []

    private commands = [
        {command: 'bio', description: '获取监听用户Bio，可发送多个，空格分隔'},
        {command: 'add', description: '添加用户监听，可发送多个，空格分隔(可添加别名::分开)'},
        {command: 'change', description: '改变用户监听状态，可发送多个，空格分隔'},
        {command: 'list', description: '列出当前监听的用户，可发送id，空格分隔'},
        {command: 'history', description: '列出单个用户Bio历史记录，发送id'},
        {command: 'alias', description: '设置用户别名，可发送多个，空格分隔 (id::alias)'},
        {
            command: 'format',
            description: `用户Bio改变后通知格式, 可用变量为 \${display_name}(优先展示别名) \${alias} \${name} \${bio} \${time} `
        },
        {command: 'send', description: '切换是否发送到当前聊天'},
        {command: 'adme', description: '私聊机器人添加自己(别问为啥不是addme ~~懒惰~~)'},
    ]

    public start() {
        this.init();
        const bot = this._bot
        bot.use(session())

        this.monitor().catch(err => {
            console.error('monitor error: ', err)
        })

        bot.start((ctx) => {
            ctx.reply('这个bot可以监控用户的Bio，并发送到指定的频道(使用前请获得别人的同意)。统一格式使用@用户名或者链接')

            // insert bot chat format
            this.dbHeller.getChatFormatByChatId(ctx.chat.id).then(chatFormat => {
                if (!chatFormat) {
                    this.dbHeller.insertChatFormat({
                        chat_id: ctx.chat.id,
                        format: BioBot.DEFAULT_FORMAT,
                        send_to_chat: true,
                        modify_time: Date.now()
                    })
                }
            })

        })

        this.userHandler()
        this.commandHandler()
        this.actionHandler()
        bot.telegram.setMyCommands(this.commands).catch(err => {
            console.error('setMyCommands error: ', err)
        })
        bot.launch().catch(err => {
            console.error('bot launch error: ', err)
        })
    }

    private commandHandler() {
        const bot = this._bot

        bot.command('bio', ctx => {
            const args = ctx.args;
            this.dbHeller.getChatFormatByChatId(ctx.chat.id).then(chatFormat => {
                if (chatFormat) {
                    this.dbHeller.getUserByIds(args.map(arg => parseInt(arg))).then(bios => {
                        bios.forEach(it => {
                            ctx.reply(this.formatMsg(chatFormat.format, it))
                        })
                    })
                } else {
                    ctx.reply('请先使用/send开启发送到当前聊天')
                }
            })
        })

        bot.command('add', ctx => {
            const args = ctx.args;
            let users = []
            try {
                users = this.argsToUsers(args);
            } catch (e) {
                return ctx.reply('格式错误')
            }
            this.getCurrentBios(users)
                .then(bios => {
                    if (!bios) {
                        return ctx.reply('添加失败')
                    }
                    bios.forEach(it => it.bio_get_time = Date.now())
                    this.dbHeller.batchInsertUsers(bios);
                    let uris = bios.map(it => it.uri);
                    this.dbHeller.getUserByUris(uris).then(insertUsers => {
                        if (insertUsers) {
                            this.dbHeller.batchInsertUserBios(insertUsers.map(user => {
                                return {
                                    user_id: user.id,
                                    bio: user.bio,
                                    create_time: Date.now()
                                } as UserBio
                            }))
                            ctx.reply("添加成功\nId DisplayName Bio\n" + this.usersToMsg(insertUsers))
                        } else {
                            ctx.reply('添加失败')
                        }
                    })
                }).catch(err => {
                console.error('add users error: ', err)
                ctx.reply('添加失败')
            })
        })
        bot.command('adme', ctx => {
            const chatId = ctx.message.from.id;
            if (chatId) {
                this.getCurrentUserInfo(chatId).then(user => {
                    this.dbHeller.getUserByUids([chatId]).then(getUsers => {
                        if (getUsers.length === 0) {
                            this.dbHeller.batchInsertUsers([user])
                            if (user.bio) {
                                this.dbHeller.getUserByUids([chatId]).then(insertUsers => {
                                    if (insertUsers) {
                                        this.dbHeller.batchInsertUserBios(insertUsers.map(user => {
                                            return {
                                                user_id: user.id,
                                                bio: user.bio,
                                                create_time: Date.now()
                                            } as UserBio
                                        }))
                                        return ctx.reply("添加成功\nId DisplayName Bio\n" + this.usersToMsg(insertUsers))
                                    } else {
                                        return ctx.reply('添加失败')
                                    }
                                })
                            }
                        } else {
                            let first = getUsers[0];
                            if (first.uri !== user.uri) {
                                this.dbHeller.batchUpdateUsers([first])
                            }
                            return ctx.reply('已添加')
                        }
                    })

                })
            } else {
               return ctx.reply('添加失败')
            }
        })

        bot.command('list', ctx => {
            const userIds = ctx.args.map(arg => parseInt(arg));

            if (userIds.length === 0) {
                this.dbHeller.listAllUsers().then(users => {
                    const sendUsersInBatches = this.sendUsersInBatches(users, BioBot.BATCH_SIZE, ctx);
                    sendUsersInBatches(0);
                });
            } else {
                this.dbHeller.getUserByIds(userIds).then(users => {
                    const sendUsersInBatches = this.sendUsersInBatches(users, BioBot.BATCH_SIZE, ctx);
                    sendUsersInBatches(0);
                });
            }
        });

        bot.command('change', ctx => {
            const users = ctx.args.map(arg => {
                return {id: parseInt(arg)} as User
            })
            if (users.length === 0) {
                return ctx.reply('请输入id')
            }
            try {
                this.dbHeller.getUserByIds(users.map(it => it.id))
                    .then(getUsers => {
                        if (getUsers) {
                            getUsers.forEach(it => it.is_deleted = !it.is_deleted)
                            this.dbHeller.batchUpdateUsers(getUsers);
                        } else {
                            ctx.reply('用户不存在')
                        }
                        ctx.reply('切换监听状态成功')
                    })
            } catch (e) {
                console.error('change error: ', e)
                ctx.reply('切换监听状态失败')
            }

        })

        bot.command('history', ctx => {
            const userId = parseInt(ctx.args[0]);
            if (!userId) {
                return ctx.reply("请输入id");
            }
            this.dbHeller.getUserBioByUserId([userId]).then(bios => {
                this.tmp_current_bios = bios
                const sendBiosInBatches = this.sendBiosInBatches(this.tmp_current_bios, BioBot.BATCH_SIZE, ctx);
                sendBiosInBatches(0);
            });
        });

        bot.command('alias', ctx => {
            const users = ctx.args.map(arg => {
                let split = arg.split(BioBot.ALIAS_SPLIT)
                return {id: parseInt(split[0]), alias: split[1]} as User
            })
            if (users.filter(it => !it.id || !it.alias).length > 0) {
                return ctx.reply('格式错误, 请使用 id::alias 格式, 多个用户空格分隔')
            }
            try {
                this.dbHeller.batchUpdateUsers(users);
                ctx.reply('更新别名成功')
            } catch (e) {
                ctx.reply('更新别名失败')
            }
        })

        bot.command('format', ctx => {
            if (!ctx.payload) {
                return ctx.reply('请带上发送模板 可用变量为 ${display_name}(优先展示别名) ${alias} ${name} ${bio} ${time}')
            }
            try {
                this.dbHeller.updateChatFormat({
                    chat_id: ctx.chat.id,
                    format: ctx.payload
                })
                ctx.reply('设置格式成功')
            } catch (e) {
                ctx.reply('设置格式失败')
            }

        })

        bot.command('send', async ctx => {

            this.dbHeller.getChatFormatByChatId(ctx.chat.id).then(chatFormat => {
                let send = true
                if (chatFormat) {
                    chatFormat.send_to_chat = !chatFormat.send_to_chat
                    send = chatFormat.send_to_chat
                    this.dbHeller.updateChatFormat(chatFormat)
                } else {
                    this.dbHeller.insertChatFormat({
                        chat_id: ctx.chat.id,
                        format: BioBot.DEFAULT_FORMAT,
                        send_to_chat: true
                    })
                }
                ctx.reply('发送到当前 ' + (send ? '开启' : '关闭'))
            }).catch(err => {
                console.error('send error: ', err)
                ctx.reply('切换失败')
            })

        })

    }

    private actionHandler() {
        const bot = this._bot
        bot.action(/history_more_(\d+)/, ctx => {
            const start = parseInt(ctx.match[1]);

            const sendBiosInBatches = this.sendBiosInBatches(this.tmp_current_bios, BioBot.BATCH_SIZE, ctx);
            sendBiosInBatches(start);

            ctx.answerCbQuery();
        });

        bot.action(/list_more_(\d+)/, ctx => {
            const start = parseInt(ctx.match[1]);

            const userIds = ctx.match.input.split(' ').slice(1).map(arg => parseInt(arg));
            if (userIds.length === 0) {
                this.dbHeller.listAllUsers().then(users => {
                    const sendUsersInBatches = this.sendUsersInBatches(users, BioBot.BATCH_SIZE, ctx);
                    sendUsersInBatches(start);
                });
            } else {
                this.dbHeller.getUserByIds(userIds).then(users => {
                    const sendUsersInBatches = this.sendUsersInBatches(users, BioBot.BATCH_SIZE, ctx);
                    sendUsersInBatches(start);
                });
            }

            ctx.answerCbQuery();
        });
    }

    private userHandler() {
        const bot = this._bot
        bot.use((ctx, next) => {

            if (ctx.chat.id > 0) {
                return next()
            }

            return bot.telegram.getChatAdministrators(ctx.chat.id)
                .then(data => {
                    if (!data || !data.length) return;
                    // @ts-ignore
                    ctx.chat._admins = data;
                    // @ts-ignore
                    ctx.from._is_in_admin_list = data.some(adm => adm.user.id === ctx.from.id);
                })
                .catch(console.error)
                .then(_ => next());
        });

        let commands = this.commands.filter(it => {
            return it.command !== 'adme'
        }).map(it => it.command).join('|');

        const cmdTriggers = new RegExp(`${commands}`);
        bot.hears(cmdTriggers, (ctx, next) => {
            // @ts-ignore
            if (ctx.chat?.type !== 'private' && !ctx.from._is_in_admin_list) {
                return ctx.reply('该命令只对群组管理员开放');
            }
            next()
        });
        bot.hears(/adme/, (ctx, next) => {
            // @ts-ignore
            if (ctx.chat.type !== 'private') {
                return ctx.reply('该命令只对私聊开放');
            }
            next()
        })
    }

    private sendUsersInBatches(userCache: User[], batchSize: number, ctx) {
        return (start = 0) => {
            const batch = userCache.slice(start, start + batchSize);
            if (batch.length > 0) {
                ctx.reply("Id DisplayName Bio\n" + this.usersToMsg(batch), {
                    reply_markup: batch.length >= BioBot.BATCH_SIZE ? {
                        inline_keyboard: [
                            [{text: '获取更多', callback_data: `list_more_${start + batchSize}`}]
                        ]
                    } : undefined
                });
            } else {
                ctx.reply('没有更多');
            }
        };
    }

    private sendBiosInBatches(bioCache: UserBio[], batchSize: number, ctx) {
        return (start = 0) => {
            const batch = bioCache.slice(start, start + batchSize);
            if (batch.length > 0) {
                ctx.reply("Time Bio\n" + this.userBiosToMsg(batch), {
                    reply_markup: batch.length >= BioBot.BATCH_SIZE ? {
                        inline_keyboard: [
                            [{
                                text: `获取更多`,
                                callback_data: `history_more_${start + batchSize}`
                            }]
                        ]
                    } : undefined
                });
            } else {
                ctx.reply('没有更多');
            }
        };
    }

    public async monitor() {

        setInterval(() => {
            this.dbHeller.listAllChatFormats().then(chatFormats => {
                this.dbHeller.listAllUsers().then(users => {
                    users.forEach(user => {
                        if (!user.is_deleted) {
                            if (!user.uid) {
                                this.getCurrentBios([user]).then(bios => {
                                    if (bios[0].bio && bios[0].bio !== user.bio) {
                                        user.bio = bios[0].bio
                                        user.bio_get_time = Date.now()
                                        this.dbHeller.batchUpdateUsers([user]);
                                        // record old bio
                                        this.dbHeller.batchInsertUserBios([{
                                            user_id: user.id,
                                            bio: user.bio,
                                            create_time: user.bio_get_time
                                        }])
                                        chatFormats.forEach(chat => {
                                            const msg = this.formatMsg(chat.format, user)
                                            this._bot.telegram.sendMessage(chat.chat_id, msg)
                                        })
                                    }
                                })
                            } else {
                                this.getCurrentUserInfo(user.uid).then(userInfo => {
                                    if (userInfo.bio && userInfo.bio !== user.bio) {
                                        user.bio_get_time = Date.now()
                                        user.bio = userInfo.bio
                                        user.uri = userInfo.uri
                                        this.dbHeller.batchUpdateUsers([user])
                                        // record old bio
                                        this.dbHeller.batchInsertUserBios([{
                                            user_id: user.id,
                                            bio: user.bio,
                                            create_time: user.bio_get_time
                                        }])
                                        chatFormats.forEach(chat => {
                                            const msg = this.formatMsg(chat.format, user)
                                            this._bot.telegram.sendMessage(chat.chat_id, msg)
                                        })
                                    }
                                })
                            }
                        }
                    })
                })
            })

        }, 30000)
    }

    private init() {
        this._token = process.env.BOT_TOKEN
        if (!this._token) {
            throw new Error('BOT_TOKEN is required')
        }
        this._bot = new Telegraf(this._token)
    }

    public async getCurrentBios(users: User[]) {
        return Promise.all(users.map(async user => {
            let res = {uri: user.uri, bio: ''} as User
            try {
                const response = await fetch(user.uri);
                const data = await response.text();
                const $ = cheerio.load(data);
                res.bio = $('meta[property="og:description"]').attr('content');
            } catch (error) {
                console.error(error);
            }
            return res;
        }));
    }

    public async getCurrentUserInfo(chatId: number) {
        return this._bot.telegram.getChat(chatId).then(chat => {
            return {
                uid: chat.id,
                // @ts-ignore
                bio: chat.bio,
                // @ts-ignore
                uri: chat.username ? BioBot.TG_AT_PREFIX + chat.username : undefined
            } as User
        })
    }

    private formatMsg(format: string, user: User) {
        const display_name = user.alias ? user.alias : user.uri?.substring(BioBot.TG_AT_PREFIX.length) ? user.uri?.substring(BioBot.TG_AT_PREFIX.length) : `uid-${user.uid}`
        return format.replace(BioBot.$DISPLAY_NAME, display_name).replace(BioBot.$ALIAS, user.alias ? user.alias : user.uri?.substring(BioBot.TG_AT_PREFIX.length))
            .replace(BioBot.$NAME, user.uri?.substring(BioBot.TG_AT_PREFIX.length))
            .replace(BioBot.$BIO, user.bio)
            .replace(BioBot.$TIME, new Date(user.bio_get_time).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }))
    }

    private argsToUsers(args: string[]): User[] {
        return args.map(arg => {
            let user: User = {} as User
            user.is_deleted = false
            if (arg.includes(BioBot.ALIAS_SPLIT)) {
                const [uri, alias] = arg.split(BioBot.ALIAS_SPLIT)
                user.alias = alias
                arg = uri
            }
            if (arg.startsWith(BioBot.TG_AT_START)) {
                user.uri = BioBot.TG_AT_PREFIX + arg.substring(1)
            } else if (arg.startsWith(BioBot.TG_AT_PREFIX)) {
                user.uri = arg
            } else {
                throw new Error('uri error')
            }
            return user
        })
    }

    private usersToMsg(users: User[]) {
        return users.map(user => {
            const username = user.uri?.substring(BioBot.TG_AT_PREFIX.length)
            return user.id + "  " +
                (user.alias ? user.alias : username ? username : `uid-${user.uid}`) + "  " +
                user.bio + (user.is_deleted ? "(不监听)" : "")
        }).join('\n')
    }

    private userBiosToMsg(userBios: UserBio[]) {
        return userBios.map(bio =>
            new Date(bio.create_time).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }) + "  " +
            bio.bio)
            .join('\n')
    }
}