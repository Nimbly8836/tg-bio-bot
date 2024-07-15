# 监听用户Bio改变发送消息
每30秒检查一次用户的Bio是否改变, 如果改变则发送消息

**监听用户bio请获得对方同意!!**

## 主要命令介绍
- `/bio` 查看当前监听用户的Bio, 回复设置格式的消息 如 `/bio 1 2 3`
- `/add` 添加监听用户可以设置别名 :: 分开  `/add @xxx::x先生 https://t.me/xxxx::x2`
- `/format` 设置当前群聊通知的格式 可用的变量有 ${alias} 别名 ${bio} Bio ${name} username ${time} bio抓取的时间 例如:  

    ```text
    /format ${bio}
    
    #${alias}bio
    ```
