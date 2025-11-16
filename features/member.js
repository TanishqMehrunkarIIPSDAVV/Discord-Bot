const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const member=()=>
{
    const roleName = "𝐌𝐄𝐌𝐁𝐄𝐑𝐒";

    client.on("guildMemberAdd", async (member) => {
        const role = member.guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            console.error(`Role "${roleName}" not found in ${member.guild.name}`);
            return;
        }
        if(member.bot) return;
        member.roles.add(role)
        .then(() => console.log(`Assigned "${roleName}" to ${member.user.tag}`))
        .catch(err => console.error("Failed to assign role:", err));
    });

}

module.exports = member;