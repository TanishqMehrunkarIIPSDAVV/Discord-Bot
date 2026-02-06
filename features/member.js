const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

const member = () => {
    // 🔹 Replace with your actual Role ID
    const ROLE_ID = "1439540626872995933";

    client.on("guildMemberAdd", async (member) => {
        try {
            const role = member.guild.roles.cache.get(ROLE_ID);
            if (!role) {
                console.error(`Role with ID "${ROLE_ID}" not found in ${member.guild.name}`);
                return;
            }

            await member.roles.add(role);
            console.log(`Assigned role to ${member.user.tag}`);
        } catch (err) {
            console.error("Failed to assign role:", err);
        }
    });
};

module.exports = member;