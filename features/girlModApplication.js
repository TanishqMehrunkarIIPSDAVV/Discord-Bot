const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Events,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

const PREFIX = "ct";
const POST_COMMAND = "postgirlmod";

const APPLY_BUTTON_ID = "girl_mod_apply";
const APPLICATION_MODAL_ID = "girl_mod_application_modal";

// Set your user ID here or via GIRL_MOD_REVIEWER_ID env var.
const REVIEWER_USER_ID = (process.env.GIRL_MOD_REVIEWER_ID || "779206329813696522").trim();

function formatApplicationEmbed({ applicant, userId, username, hours, experience }) {
    return new EmbedBuilder()
        .setColor("#ff4d8d")
        .setTitle("New Girl Mod Application")
        .addFields(
            { name: "Applicant", value: `${applicant.tag} (${applicant.id})` },
            { name: "Provided User ID", value: userId || "Not provided" },
            { name: "Provided Username", value: username || "Not provided" },
            { name: "Hours Available", value: hours || "Not provided" },
            { name: "Why You Want To Mod / Experience", value: experience || "Not provided" }
        )
        .setTimestamp(new Date());
}

const girlModApplication = () => {
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return;

        const content = message.content.trim();
        const commandStart = `${PREFIX} ${POST_COMMAND}`;
        if (!content.toLowerCase().startsWith(commandStart)) return;

        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await message.reply("You need **Manage Server** permission to post this application message.");
            return;
        }

        const announcementText = content.slice(commandStart.length).trim();
        const displayText = announcementText.length
            ? announcementText
            : "Applications for **Girl Mod** are now open. Click **Apply Now** and fill the form.";

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(APPLY_BUTTON_ID)
                .setLabel("Apply Now")
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({
            content: `@everyone\n${displayText}`,
            components: [row],
            allowedMentions: { parse: ["everyone"] },
        });

        await message.reply("Girl mod application post sent.");
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isButton() && interaction.customId === APPLY_BUTTON_ID) {
            const modal = new ModalBuilder()
                .setCustomId(APPLICATION_MODAL_ID)
                .setTitle("Girl Mod Application");

            const userIdInput = new TextInputBuilder()
                .setCustomId("app_user_id")
                .setLabel("Your User ID")
                .setPlaceholder("Example: 123456789012345678")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const usernameInput = new TextInputBuilder()
                .setCustomId("app_username")
                .setLabel("Your Username")
                .setPlaceholder("Example: username#0001 or username")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const hoursInput = new TextInputBuilder()
                .setCustomId("app_hours")
                .setLabel("How many hours can you moderate?")
                .setPlaceholder("Example: 3-5 hours daily")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const experienceInput = new TextInputBuilder()
                .setCustomId("app_experience")
                .setLabel("Experience / Why should we select you?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder().addComponents(userIdInput),
                new ActionRowBuilder().addComponents(usernameInput),
                new ActionRowBuilder().addComponents(hoursInput),
                new ActionRowBuilder().addComponents(experienceInput)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === APPLICATION_MODAL_ID) {
            const userId = interaction.fields.getTextInputValue("app_user_id").trim();
            const username = interaction.fields.getTextInputValue("app_username").trim();
            const hours = interaction.fields.getTextInputValue("app_hours").trim();
            const experience = interaction.fields.getTextInputValue("app_experience").trim();

            if (!REVIEWER_USER_ID || REVIEWER_USER_ID === "PUT_USER_ID_HERE") {
                await interaction.reply({
                    content: "Application submitted, but reviewer ID is not configured yet. Ask admin to set `GIRL_MOD_REVIEWER_ID` or edit the feature file.",
                    ephemeral: true,
                });
                return;
            }

            try {
                const reviewerUser = await client.users.fetch(REVIEWER_USER_ID);
                const embed = formatApplicationEmbed({
                    applicant: interaction.user,
                    userId,
                    username,
                    hours,
                    experience,
                });

                await reviewerUser.send({ embeds: [embed] });

                await interaction.reply({
                    content: "Your application has been submitted successfully.",
                    ephemeral: true,
                });
            } catch (error) {
                console.error("Failed to send application DM:", error);
                await interaction.reply({
                    content: "Could not submit your application right now. Please try again later.",
                    ephemeral: true,
                });
            }
        }
    });
};

module.exports = girlModApplication;
