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
    static DEFAULT_FORMAT = '用户${name}更新: ${bio}'
    static $ALIAS = '${alias}'
    static $NAME = '${name}'
    static $BIO = '${bio}'
    static $TIME = '${time}'
    static ALIAS_SPLIT = '::'
    static BATCH_SIZE = 6;
    private dbHeller: DbHeller = new DbHeller()
    private tmp_current_bios: UserBio[] = []

    public start() {
        this.init();
        const bot = this._bot
        bot.use(session())

        this.monitor()

        bot.start((ctx) => {
            ctx.reply('这个bot可以监控用户的bio，并发送到指定的频道(使用前请获得别人的同意)。统一格式使用@用户名或者链接')

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

        const commands = [
            {command: 'bio', description: '获取监听用户bio，可发送多个，空格分隔'},
            {command: 'add', description: '添加用户监听，可发送多个，空格分隔(可添加别名::分开)'},
            {command: 'rm', description: '移除用户监听，可发送多个，空格分隔'},
            {command: 'list', description: '列出当前监听的用户，可发送id，空格分隔'},
            {command: 'history', description: '列出单个用户bio历史记录，发送id'},
            {command: 'alias', description: '设置用户别名，可发送多个，空格分隔 (id::alias)'},
            {command: 'format', description: `用户bio改变后通知格式,可用变量为 \${alias} \${name} \${bio}`},
            {command: 'send', description: '切换是否发送到当前群聊'},
        ]

        this.commandHandler()
        this.actionHandler()
        bot.telegram.setMyCommands(commands)
        bot.launch().then(r => {
            console.log('bot started')
        })
    }

    private commandHandler() {
        const bot = this._bot

        bot.command('bio', ctx => {
            const args = ctx.args;
            this.dbHeller.getChatFormatByChatId(ctx.chat.id).then(chatFormat => {
                this.dbHeller.getUserByIds(args.map(arg => parseInt(arg))).then(bios => {
                    bios.forEach(it => {
                        ctx.reply(this.formatMsg(chatFormat.format, it))
                    })
                })
            })
        })

        bot.command('add', ctx => {
            const args = ctx.args;
            const users = this.argsToUsers(args);
            this.getCurrentBios(users)
                .then(bios => {
                    users.forEach(it => it.bio_get_time = Date.now())
                    this.dbHeller.batchInsertUsers(users);
                    let uris = users.map(it => it.uri);
                    this.dbHeller.getUserByUris(uris).then(insertUsers => {
                        ctx.reply("添加成功,Id Name/alias Bio:\n" + this.usersToMsg(insertUsers))
                    })
                }).catch(err => {
                console.error('add users error: ', err)
                ctx.reply('添加失败')
            })
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

        bot.command('rm', ctx => {
            const users = ctx.args.map(arg => {
                return {id: parseInt(arg), is_deleted: true} as User
            })
            try {
                this.dbHeller.batchUpdateUsers(users);
                ctx.reply('删除监听成功')
            } catch (e) {
                ctx.reply('删除监听失败')
            }

        })


        bot.command('history', ctx => {
            const userId = parseInt(ctx.args[0]);
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
            try {
                this.dbHeller.batchUpdateUsers(users);
                ctx.reply('更新别名成功')
            } catch (e) {
                ctx.reply('更新别名失败')
            }
        })

        bot.command('format', ctx => {
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
                if (chatFormat) {
                    chatFormat.send_to_chat = !chatFormat.send_to_chat
                    this.dbHeller.updateChatFormat(chatFormat)
                } else {
                    this.dbHeller.insertChatFormat({
                        chat_id: ctx.chat.id,
                        format: BioBot.DEFAULT_FORMAT,
                        send_to_chat: true
                    })
                }
                ctx.reply('切换成功')
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

    private sendUsersInBatches(userCache: User[], batchSize: number, ctx) {
        return (start = 0) => {
            const batch = userCache.slice(start, start + batchSize);
            if (batch.length > 0) {
                ctx.reply("Id Name/Alias Bio\n" + this.usersToMsg(batch), {
                    reply_markup: batch.length >= BioBot.BATCH_SIZE ? {
                        inline_keyboard: [
                            [{text: '获取更多', callback_data: `list_more_${start + batchSize}`}]
                        ]
                    } : undefined
                });
            } else {
                ctx.reply('没有更多记录。');
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
                                text: `history_more_${start + batchSize}`,
                                callback_data: `history_more_${start + batchSize}`
                            }]
                        ]
                    } : undefined
                });
            } else {
                ctx.reply('没有更多记录。');
            }
        };
    }

    public async monitor() {

        setInterval(() => {
            this.dbHeller.listAllChatFormats().then(chatFormats => {
                this.dbHeller.listAllUsers().then(users => {
                    users.forEach(user => {
                        if (!user.is_deleted) {
                            this.getCurrentBios([user]).then(bios => {
                                if (bios[0].bio !== user.bio) {
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

    private formatMsg(format: string, user: User) {
        return format.replace(BioBot.$ALIAS, user.alias)
            .replace(BioBot.$NAME, user.uri.substring(BioBot.TG_AT_PREFIX.length))
            .replace(BioBot.$BIO, user.bio)
            .replace(BioBot.$TIME, new Date().toLocaleString())
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
            } else {
                user.uri = arg
            }
            return user
        })
    }

    private usersToMsg(users: User[]) {
        return users.map(user =>
            user.id + "  "
            + user.alias ? user.alias : user.uri.substring(BioBot.TG_AT_PREFIX.length) + "  "
                + user.bio)
            .join('\n')
    }

    private userBiosToMsg(userBios: UserBio[]) {
        return userBios.map(bio =>
            new Date(bio.create_time).toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"}) + "  "
            + bio.bio)
            .join('\n')
    }
}