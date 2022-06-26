const { Client } = require('pg');
const format = require('pg-format');

var allCafeInfo;
var allSuperBotsInfo;
var connetion_options = {
    connectionString: process.env.DB_URL,
}
var lastGraphUpdateTime = [];


const client = new Client(connetion_options);
 if(process.env.TESTING != 1)
     connetion_options.ssl = {
         rejectUnauthorized: false
     }
module.exports = {
    async updatePricelist(arr){
        try{
            await client.query('truncate table pricelist');
            var sql = format('INSERT INTO pricelist (name, description, weight, price, "cafeId") VALUES %L', arr);
            await client.query(sql);
        } catch (err){
            console.log(getFuncName()+" failed. "+ err.stack)
        }
    },
    async updateReserveGraph(cafeId, superBotId, rows){
        if((cafeId === null) || (cafeId === undefined)) cafeId = -1;
        if((superBotId === null) || (superBotId === undefined)) superBotId = -1;
        try{
            const curUdpTime = Date.now();
            if(lastGraphUpdateTime[cafeId] === undefined) lastGraphUpdateTime[cafeId] = [];  
            if((curUdpTime - lastGraphUpdateTime[cafeId][superBotId]) < 150000) return;
            lastGraphUpdateTime[cafeId][superBotId] = curUdpTime;

            await client.query('DELETE FROM graphs WHERE cafeid = $1 AND superbotid = $2',
                [cafeId, superBotId]);
            for(let i = 0; i < rows.length; i++){
                //if((rows[i].step === undefined) || (rows[i].step === null)) continue;
                await client.query('INSERT INTO graphs VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [cafeId, superBotId, i, rows[i].step, rows[i].question, rows[i].answer, rows[i].nextQuestion, rows[i].nextStep]); 
            };
        } catch (err){
            console.log(getFuncName()+" failed. "+ err.stack)
        }
    },
//===============Getting
    async getAllCafesInfo(){
        try{
            if(!allCafeInfo)
                await updateAllCafesInfo();
        } catch (e){console.log(e)}
        allCafeInfo.forEach(x => {
            try{
                x.parsedVbManagerChatIds = JSON.parse(x.vbManagerChatId);
            }catch (e){
                x.parsedVbManagerChatIds = undefined;
                if(x.vbManagerChatId.length != 0) console.log('Cannot parse Viber chatId of Manager. Must be in JSON(["sdfs","sdfs"]');
            }
        })
        return allCafeInfo;
    },
    async getAllSuperBotsInfo(){
        try{
            if(!allSuperBotsInfo)
                await updateAllSuperBotsInfo();
        } catch (e){console.log(e)}

        return allSuperBotsInfo;
    },
    async getSuperBotInfo(botId){
        try{
            if(!allSuperBotsInfo)
                await updateAllSuperBotsInfo();
        } catch (e){console.log(e)}
        return allSuperBotsInfo.find(x => x.superBotId === botId);
    },
    async getCafeInfo(cafeId){
        try{
            if(!allCafeInfo)
                await updateAllCafesInfo();
        } catch (e){console.log(e)}
        let cafeInfo = allCafeInfo.find(x => x.cafeId === cafeId);
        return cafeInfo;
    },


    getFuncName
}
async function updateAllCafesInfo() {
    try {
        var res = await client.query('SELECT * FROM cafes')
    } catch (err) {console.log(err)}
    if(res.rowCount != 0)
        allCafeInfo = res.rows;
}
async function updateAllSuperBotsInfo(){
    try {
        var res = await client.query('SELECT * FROM superbots')
    } catch (err) {console.log(err)}
    if(res.rowCount != 0)
        allSuperBotsInfo = res.rows;
}
setInterval(updateAllCafesInfo, 60000);

try{
    client.connect();
} catch (err) { console.log(err)}

function getFuncName()
{
    return getFuncName.caller.name;
}
global.getFuncName = getFuncName;