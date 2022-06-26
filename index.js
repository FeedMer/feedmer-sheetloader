require('dotenv').config()
const { GoogleSpreadsheet } = require('google-spreadsheet');
const db = require('./DBlib');
const request = require("request");
const minUpdInterval = 5*60*1000;
const FEEDMER_URL = process.env.FEEDMER_URL
var graphs = {};

global.sleep =
    function sleep(ms){
        return new Promise(resolve=>{
            setTimeout(resolve,ms)
        })
    }

var express = require('express');
var app = express();
var server = app.listen(process.env.PORT || 80, function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log('Web server started at http://%s:%s', host, port);
});
global.app = app;
app.get("/init", function (req, res) {
    
});
app.get("/pricelists", async function (req, res) {
    try{
        await updateAllPricelists();
        res.send('OK');
    }
    catch(e){
        res.send(e.stack);
    }
});

async function getAllPricelists(){
    try {
        let cafesInfo = await db.getAllCafesInfo();
        let arr=[];
        for(var i=0; i<cafesInfo.length; i++){
            if(!cafesInfo[i].ssBackId) continue;
            let arr_loc = await getPricelist(cafesInfo[i].cafeId);
            arr = arr.concat(arr_loc);
        }
        return arr;
    } catch (e){
        console.log(db.getFuncName()+" "+e);
        throw new Error('cannot get pricelist from google sheets');
    }

}
async function getPricelist(cafeId){
    try {
        let cafeInfo = await db.getCafeInfo(cafeId);
        let cafeSSID = cafeInfo.ssBackId;
        if(!cafeSSID) return 0;

        const doc = new GoogleSpreadsheet(cafeSSID);
        await doc.useServiceAccountAuth(require('./client_secret_google_sheets.json'));
        await doc.loadInfo(); // loads document properties and worksheets

        const sheet = doc.sheetsByTitle["Общий справочник"]; // or use doc.sheetsById[id]
        let rows = await sheet.getRows();
        let rowsWithoutEmptyNames = rows.filter(x => x._rawData.length !== 0);
        let arr = [];
        for (let i = 0; i < rowsWithoutEmptyNames.length; i++) {
            let name = "";
            let description = "";
            let weight = "";
            let price = 0;
            if (rowsWithoutEmptyNames[i]._rawData[0] !== undefined) name = rowsWithoutEmptyNames[i]._rawData[0].trim();
            if (rowsWithoutEmptyNames[i]._rawData[1] !== undefined) description = rowsWithoutEmptyNames[i]._rawData[1];
            if (rowsWithoutEmptyNames[i]._rawData[2] !== undefined) weight = rowsWithoutEmptyNames[i]._rawData[2];
            let parsedPrice = parseInt(rowsWithoutEmptyNames[i]._rawData[3], 10);
            if (!isNaN(parsedPrice)) price = parsedPrice;
            arr.push([name, description, weight, price, cafeId]);
        }
        return arr;
    } catch (e){
        console.log(db.getFuncName()+" "+e);
        throw new Error('cannot get pricelist from google sheets');
    }
}

var graphs = {};

async function updateGraphs(){
    try{
        let cafesInfo = await db.getAllCafesInfo();

        for(let i=0; i<cafesInfo.length; i++)
            await updateCafeGraphFromSS(cafesInfo[i]);

        let superBotInfo = await db.getAllSuperBotsInfo();
        for(let i=0; i<superBotInfo.length; i++){
            await updateSuperBotGraphFromSS(null, superBotInfo[i])
            for(let j=0; j<cafesInfo.length; j++)
                await shuffleGraphs(cafesInfo[j], superBotInfo[i]);
        }
        request.get({
            headers: {'content-type' : 'application/json', "User-Agent" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:77.0) Gecko/20100101 Firefox/77.0"},
            url: FEEDMER_URL + "/updateGraphs",
        }, function(err, response, body){
            if (err || (response.statusCode !== 200)) {   
                if(err) console.log("Calling FeedMer updateGraphs failed!: " + err);
                else console.log("Calling FeedMer updateGraphs failed!: " + response.statusCode + '. ' + response.statusMessage);
            }
        });

    } catch (e){ console.log(getFuncName()+" failed. "+ e.stack) }
}

async function loadSSGraph(ssBackId, cafeId, superBotId){
    const doc = new GoogleSpreadsheet(ssBackId);
    await doc.useServiceAccountAuth(require('./client_secret_google_sheets.json'));
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle["Граф"];
    let res = await sheet.getRows();
    res.forEach(x => {
        if (x._rawData[2] !== undefined) x._rawData[2] = x._rawData[2].trim();
    });
    graphs[cafeId][superBotId] = res;
    await db.updateReserveGraph(cafeId, superBotId, res);
}
async function updateCafeGraphFromSS(cafeInfo){
    try{
        let cafeId = cafeInfo.cafeId;
        let ssBackId = cafeInfo.ssBackId;
        if(!cafeInfo.ssBackId)
            return 0;

        if(graphs[cafeId] === undefined) 
            graphs[cafeId] = {};
        await loadSSGraph(ssBackId, cafeId, null);
    }catch(e){console.log(db.getFuncName()+" "+e)}
}
async function updateSuperBotGraphFromSS(cafeInfo, superBotInfo){
    try{
        if(!superBotInfo.ssBackId) throw new Error('супербот ' + superBotInfo.superBotName + ' не имеет ссылки на граф');
        let ssBackId = superBotInfo.ssBackId;
        let superBotId = superBotInfo.superBotId;
        let cafeId;
        if(cafeInfo === undefined || cafeInfo === null) cafeId = null;
        else cafeId = cafeInfo.cafeId;

        if(graphs[cafeId] === undefined) 
            graphs[cafeId] = {};
        await loadSSGraph(ssBackId, cafeId, superBotId);
    }catch(e){console.log(db.getFuncName()+" "+e.stack)}
}
async function shuffleGraphs(cafeInfo, superBotInfo){
    try{
        let superBotId = superBotInfo.superBotId;
        let cafeId = cafeInfo.cafeId;

        if((graphs[cafeId] === undefined) || (graphs[cafeId][null] === undefined)) {
            console.log('shuffleGraphs failed. Bad cafe graph for cloning with id ' + cafeId)
            return;
        }
        if((graphs[null] === undefined) || (graphs[null][superBotId] === undefined)) {
            console.log('shuffleGraphs failed. Bad superBot graph for cloning with id ' + superBotId)
            return;
        }

        let cafeGraph = graphs[cafeId][null];
        let superBotGraph = graphs[null][superBotId];
        let shuffledGraph = cloneGraph(superBotGraph);

        for(let i=0; i<cafeGraph.length; i++){
            if((cafeGraph[i].step === undefined) || (cafeGraph[i].step === null)) continue;
            let rowInSuperBotGraphWithTheSameStep = superBotGraph.find(x => x.step === cafeGraph[i].step);
            if(rowInSuperBotGraphWithTheSameStep === undefined){
                shuffledGraph.push(Object.assign({}, cafeGraph[i]));
            } else {
                if(rowInSuperBotGraphWithTheSameStep.question === ""
                    ||  rowInSuperBotGraphWithTheSameStep.question[0] === "/")
                    shuffledGraph.push(Object.assign({}, cafeGraph[i]));
            }
        }

        for(let i=0; i<cafeGraph.length; i++)
            for(let j=0; j<shuffledGraph.length; j++)
                if ( shuffledGraph[j].step === cafeGraph[i].step && shuffledGraph[j].step !== undefined && shuffledGraph[j].step !== null
                    && (shuffledGraph[j].question === "" || shuffledGraph[j].question[0] === '/'))
                    shuffledGraph[j].question = cafeGraph[i].question;

        graphs[cafeId][superBotId] = shuffledGraph;
        await db.updateReserveGraph(cafeId, superBotId, shuffledGraph);
    }catch(e){console.log(db.getFuncName()+" "+e)}
}
function cloneGraph(graphToClone){
    let newGraph = [];
    for( let i = 0; i<graphToClone.length; i++){
        newGraph.push({
            step: graphToClone[i].step,
            question: graphToClone[i].question,
            answer: graphToClone[i].answer,
            nextQuestion: graphToClone[i].nextQuestion,
            nextStep: graphToClone[i].nextStep
        })
    }
    return newGraph;
}
//changing time in testing stand
async function setTimeForTesting(testSSID,hourOfNewTime){
    const doc = new GoogleSpreadsheet(testSSID);
    await doc.useServiceAccountAuth(require('./client_secret_google_sheets.json'));
    await doc.loadInfo(); // loads document properties and worksheets

    const sheet = doc.sheetsByTitle["Параметры"];
    await sheet.loadCells('A1:E10'); // or use doc.sheetsById[id]
    let cellWithTime= await sheet.getCell(5,1);
    cellWithTime.value = hourOfNewTime;
    await sheet.saveUpdatedCells();
    await updateGraphs();
}

//data updating
async function updateAllPricelists(){
    try{
        var arr = await getAllPricelists();
        await db.updatePricelist(arr);
    } catch (e){ console.log(getFuncName()+" failed. "+ e.stack) }
}

async function permanentlyUpdGraphs(){
    while(true){
        let timeStart = Date.now();
        await updateGraphs();
        let workTime = Date.now() - timeStart;
        if(workTime < minUpdInterval) await global.sleep(minUpdInterval - workTime)
        else await sleep(1000);
    }
}


async function init(){
    permanentlyUpdGraphs();
    updateAllPricelists();
    setInterval(await updateAllPricelists, 15*60*1000);
}

//execution
(async () => {
    await init();
    if(process.env.TESTING === 1) makeTunnel()
})();


async function makeTunnel(){
    const ngrok = require('./node_modules/ngrok');
    await ngrok.authtoken(process.env.NGROK_TOKEN);
    //try
    global.testingURL = await ngrok.connect();
    console.log(global.testingURL);
}