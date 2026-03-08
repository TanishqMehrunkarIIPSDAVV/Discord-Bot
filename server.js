const express=require("express");
const server=express()
let started = false;

server.all("/",(req,res)=>{
  res.send("Bot is running!!!");
});

function startServer()
{
    if (started) return;
    started = true;

    const port = Number(process.env.PORT) || 3000;
    const listener = server.listen(port,()=>
    {
      console.log(`Ready Server on port ${port}!!!`)
    });

    listener.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.warn(`Port ${port} is already in use. Continuing without starting web server.`);
        return;
      }
      console.error("Server failed to start:", err);
    });
}

module.exports=startServer;