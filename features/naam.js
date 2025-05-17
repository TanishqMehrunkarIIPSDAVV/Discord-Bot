const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const {roleMention,userMention}=require("discord.js");

const obj={
    "vc" : `${roleMention("969165296621461524")}`,
    "brawl" : `${roleMention("957920699677286400")}`,
    "brawlhalla" : `${roleMention("957920699677286400")}`,
    "zakie" : "I am the lurker here 😎",
    "devu" : "Choti Billi hu me 🐱",
    "devanshi" : "Choti Billi hu me 🐱",
    "prigaya" : "Meri biwi ko koi kuch nhi bolega 😗",
    "abid" : "Meri prigaya ko koi kuch nhi bolega 😍",
    "prim ki biwi" : "Meri prigaya ko koi kuch nhi bolega 😍",
    "saswat" : "Kya me yaad hu tumhe? 😏",
    "bella" : "Kya aapko pata he mera ghar Aluminium ka he 😅",
    "harmeet" : "Kya aapko pata he mera ghar Aluminium ka he 😅",
    "aditya" : "Bandar hu me 🐵",
    "srimjoy" : "Pepsi peeyo kyonki me chumtiya hu 😊",
    "sunny" : "Nashedi hu me, fir bhi owner hu me 😎",
    "somie" : "Me hu Sonnie Meri Tamanna 🙂"    ,
    "deepu" : "Noob hu me, papa ki pari hu me 🤩",
    "deepsikha" : "Noob hu me, papa ki pari hu me 🤩",
    "umang" : "Apni gendo me lelo mujhe 😋",
    "aryan" : "Naya laptop k saath bhi skills bada nhi saka 😑",
    "humdard" : "Tu mera dard he,tu mera humdard he 😭",
    "tanishq" : "Today is your lucky day, fellas 😏",
    "arpit" : "Kanyaein honi chahihe paas me 🤔",
    "kartikey" : "I am the Giga Nigga here 😏",
    "cameshia" : "Me in kutto k saamne nhi naachungi 🤡",
    "basanti" : "Me in kutto k saamne nhi naachungi 🤡",
    "rishi" : "I'm a Barbie girl, in a Barbie world 💅🙆‍♀️",
    "valo" : `${roleMention("1099698560703930478")}`,
    "valorant" : `${roleMention("1099698560703930478")}`,
    "valorand" : `${roleMention("1099698560703930478")}`,
};

const naam=()=>
{
    client.on("messageCreate",async (message)=>
    {
        if(message.author.bot) return;
        message.content=message.content.toLowerCase();
        for(const [key,value] of Object.entries(obj))
        {
            if(message.content === key)
                message.channel.send(value);
        }
    });
}
module.exports=naam;