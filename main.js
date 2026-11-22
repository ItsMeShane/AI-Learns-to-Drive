const carCanvas=document.getElementById("carCanvas");
carCanvas.width=200;
const networkCanvas=document.getElementById("networkCanvas");
networkCanvas.width=300;

const carCtx = carCanvas.getContext("2d");
const networkCtx = networkCanvas.getContext("2d");

const road=new Road(carCanvas.width/2,carCanvas.width*0.9);

const N=300;
const START_Y=100;

// the best few brains of each generation become the parents of the next
const PARENT_COUNT=10;

// each row of traffic lists the lanes it blocks
const TRAFFIC_ROW_Y=[-100,-300,-500,-700];
const MAIN_TRACK=[[1],[0,2],[0,1],[1,2]];
const RANDOM_TRACKS=2;

const FINISH_GAP=500;
let finishLineAnnounced=false;

const BRAIN_VERSION=2;
const hadSave=localStorage.getItem("brains")!==null||
    localStorage.getItem("bestBrain")!==null;
localStorage.removeItem("bestBrain");
let parents=loadParents();
const saveDiscarded=hadSave&&parents.length==0;
if(parents.length==0){
    clearTraining();
}

const trained=localStorage.getItem("trained")=="true";
let winner=null;
const TRACK_COUNT=trained?1:1+RANDOM_TRACKS;

const DEFAULT_MUTATION=0.4;
let mutation=loadMutation();

// sometimes cars will tailgate forever and never crash.
// remove them if they get taken out
const STALL_FRAMES=180;

const RESTART_AFTER=20;
const MIN_IMPROVEMENT=10;
let bestMainScore=loadNumber("bestMainScore",-Infinity);
let stuckGenerations=loadNumber("stuckGenerations",0);

const STEPS_PER_SECOND=60;
const STEP_MS=1000/STEPS_PER_SECOND;
const STEP_TOLERANCE_MS=1;
const MAX_CATCHUP_MS=250;
let lastTime=null;
let pendingMs=0;

const SPEEDS=[1,2,4];
let speed=loadSpeed();

// when trained, show the winner's generation instead of counting on
const savedGeneration=Number(localStorage.getItem("generation"))||1;
let generation=trained
    ?savedGeneration
    :parents.length>0?savedGeneration+1:1;

// a generation's brains drive every track, and each brain's results add up
let track=1;
let brains;
let results;
// every track gets a fresh set of cars and traffic
let cars;
let traffic;
let trafficStartY;
let bestCar;
let aliveCount;
let frame;
let trackOver;
let endFrame;
let nextTrackDue=false;
let toastTimer=null;

const controlBar=document.getElementById("controlBar");
const mutationSlider=document.getElementById("mutationSlider");
const mutationValue=document.getElementById("mutationValue");
mutationSlider.value=mutation;
mutationValue.textContent=mutation.toFixed(2);
mutationSlider.addEventListener("input",()=>{
    mutation=Number(mutationSlider.value);
    mutationValue.textContent=mutation.toFixed(2);
    localStorage.setItem("mutation",mutation);
});
// the current cars were already mutated when this generation started
mutationSlider.addEventListener("change",()=>{
    const when=trained||winner?"after a reset":"from the next generation";
    showToast("Mutation "+Number(mutationSlider.value).toFixed(2)+
        " applies "+when);
});

// the brain input under the mouse
let hoveredInput=null;
networkCanvas.addEventListener("pointermove",hoverInput);
networkCanvas.addEventListener("pointerdown",hoverInput);
networkCanvas.addEventListener("pointerleave",e=>{
    if(e.pointerType!="touch"){
        hoveredInput=null;
        networkCanvas.style.cursor="";
    }
});

// applies straight away and is kept across generations
for(const option of SPEEDS){
    const radio=document.getElementById("speed"+option);
    radio.checked=option==speed;
    radio.addEventListener("change",()=>{
        speed=option;
        localStorage.setItem("speed",option);
    });
}

startTrack();
if(saveDiscarded){
    showToast("Saved brain no longer fits the network. Training starts over");
}
step();
draw(0);
requestAnimationFrame(animate);

function hoverInput(e){
    const rect=networkCanvas.getBoundingClientRect();
    hoveredInput=Visualizer.inputAt(
        (e.clientX-rect.left)*networkCanvas.width/rect.width,
        (e.clientY-rect.top)*networkCanvas.height/rect.height
    );
    networkCanvas.style.cursor=hoveredInput===null?"":"help";
}

function loadSpeed(){
    const stored=Number(localStorage.getItem("speed"));
    return SPEEDS.includes(stored)?stored:1;
}

function loadMutation(){
    const stored=localStorage.getItem("mutation");
    const value=stored===null?NaN:Number(stored);
    if(Number.isFinite(value)&&value>=0&&value<=1){
        return value;
    }
    return DEFAULT_MUTATION;
}

function loadNumber(key,fallback){
    const stored=localStorage.getItem(key);
    const value=stored===null?NaN:Number(stored);
    return Number.isFinite(value)?value:fallback;
}

function loadParents(){
    let brains;
    try{
        brains=JSON.parse(localStorage.getItem("brains"));
    }catch(e){
        return [];
    }
    if(!Array.isArray(brains)||brains.length==0||
        Number(localStorage.getItem("brainVersion"))!=BRAIN_VERSION){
        return [];
    }
    const freshBrain=generateCars(1)[0].brain;
    return brains.every(b=>sameShape(b,freshBrain))?brains:[];
}

function sameShape(a,b){
    return Array.isArray(a?.levels)&&
        a.levels.length==b.levels.length&&
        a.levels.every((level,i)=>
            level.weights?.length==b.levels[i].weights.length&&
            level.biases?.length==b.levels[i].biases.length);
}

function save(){
    if(parents.length>0){
        localStorage.setItem("brains",JSON.stringify(parents));
    }else{
        // right after a restart there's nothing worth keeping yet
        localStorage.removeItem("brains");
    }
    localStorage.setItem("brainVersion",BRAIN_VERSION);
    localStorage.setItem("generation",generation);
    localStorage.setItem("bestMainScore",bestMainScore);
    localStorage.setItem("stuckGenerations",stuckGenerations);
}

function clearTraining(){
    for(const key of ["brains","brainVersion","generation","trained",
        "bestMainScore","stuckGenerations"]){
        localStorage.removeItem(key);
    }
}

function resetTraining(){
    if(!confirm("Discard the saved brains and start training again from random cars?")){
        return;
    }
    clearTraining();
    location.reload();
}

function showToast(message){
    const toast=document.getElementById("toast");
    toast.textContent=message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>toast.classList.remove("show"),1500);
}

// unlike a toast, the banner stays up. later toasts appear below it
function showBanner(title,detail){
    document.getElementById("bannerTitle").textContent=title;
    document.getElementById("bannerDetail").textContent=detail;
    document.getElementById("banner").classList.add("show");
    document.body.classList.add("banner-shown");
    clearTimeout(toastTimer);
    document.getElementById("toast").classList.remove("show");
}

function startTrack(){
    traffic=generateTraffic(track==1?MAIN_TRACK:randomTrack());
    trafficStartY=traffic[0].y;
    cars=generateCars(trained?1:N);
    if(track==1){
        brains=breed(cars.map(c=>c.brain),parents);
        results=brains.map(()=>({finishedTracks:0,totalScore:0,ending:""}));
    }
    for(let i=0;i<cars.length;i++){
        cars[i].brain=brains[i];
    }
    bestCar=cars[0];
    aliveCount=cars.length;
    frame=0;
    trackOver=false;
    endFrame=null;
    finishLineAnnounced=false;
}

function generateTraffic(track){
    const traffic=[];
    track.forEach((lanes,row)=>{
        for(const lane of lanes){
            traffic.push(new Car(road.getLaneCenter(lane),TRAFFIC_ROW_Y[row],
                30,50,"DUMMY",2,getRandomColor()));
        }
    });
    return traffic;
}

function randomTrack(){
    return MAIN_TRACK.map(lanes=>shuffle([0,1,2]).slice(0,lanes.length));
}

function generateCars(N){
    const cars=[];
    for(let i=1;i<=N;i++){
        const car=new Car(road.getLaneCenter(1),START_Y,30,50,"AI");
        car.passed=0;
        car.score=0;
        car.bestScore=-Infinity;
        car.lastGainFrame=0;
        car.stalled=false;
        car.finished=false;
        car.finishFrame=null;
        car.lastY=START_Y;
        car.finishY=null;
        cars.push(car);
    }
    return cars;
}

function copyBrain(brain){
    return JSON.parse(JSON.stringify(brain));
}

function breed(randomBrains,parents){
    if(parents.length==0){
        return randomBrains;
    }
    const brains=[];
    const eliteCount=Math.min(parents.length,randomBrains.length);
    for(let i=0;i<eliteCount;i++){
        brains.push(copyBrain(parents[i]));
    }
    const childCount=randomBrains.length-eliteCount;
    // with 5 parents the shares are 5:4:3:2:1, best first
    const totalWeight=parents.length*(parents.length+1)/2;
    let weightSoFar=0;
    let start=0;
    for(let r=0;r<parents.length;r++){
        weightSoFar+=parents.length-r;
        const end=Math.round(childCount*weightSoFar/totalWeight);
        const count=end-start;
        for(let k=0;k<count;k++){
            const brain=copyBrain(parents[r]);
            const amount=mutation*2*(k+0.5)/count;
            NeuralNetwork.mutate(brain,amount);
            brains.push(brain);
        }
        start=end;
    }
    return brains;
}

// most tracks finished first, then the highest total score
function rankBrains(){
    return brains.map((brain,i)=>({brain,...results[i]}))
        .sort((a,b)=>b.finishedTracks-a.finishedTracks||
            b.totalScore-a.totalScore);
}

function pickParents(ranked){
    const picked=[];
    for(const entry of ranked){
        if(picked.length==PARENT_COUNT){
            break;
        }
        const sameDrive=picked.some(p=>p.ending==entry.ending);
        if(!sameDrive){
            picked.push(entry);
        }
    }
    return picked.map(entry=>copyBrain(entry.brain));
}

function updateScores(){
    const trafficProgress=trafficStartY-traffic[0].y;
    for(let i=0;i<cars.length;i++){
        const car=cars[i];
        if(car.damaged||car.finished){
            continue;
        }
        car.passed=traffic.filter(t=>car.y<t.y).length;
        car.score=(START_Y-car.y)-trafficProgress;
        const aheadOfTraffic=car.passed==traffic.length;
        if(car.finishY===null&&aheadOfTraffic){
            car.finishY=car.y-FINISH_GAP;
            if(!finishLineAnnounced){
                finishLineAnnounced=true;
                showToast("All traffic passed! Finish line ahead");
            }
        }
        // only the frame it crosses counts, so a car that reaches its line
        // behind traffic can't finish later by passing beyond it
        const crossed=car.finishY!==null&&car.lastY>car.finishY&&car.y<=car.finishY;
        car.lastY=car.y;
        if(crossed&&aheadOfTraffic){
            car.finished=true;
            car.finishFrame=frame;
            continue;
        }
        if(car.score>car.bestScore+0.5){
            car.bestScore=car.score;
            car.lastGainFrame=frame;
        }else if(frame-car.lastGainFrame>STALL_FRAMES){
            car.damaged=true;
            car.stalled=true;
        }
    }
}

// finishers beat everyone, and the earliest finisher beats the rest
function isBetter(a,b){
    if(a.finished!=b.finished){
        return a.finished;
    }
    if(a.finished&&a.finishFrame!=b.finishFrame){
        return a.finishFrame<b.finishFrame;
    }
    if(a.score!=b.score){
        return a.score>b.score;
    }
    if(a.damaged!=b.damaged){
        return !a.damaged;
    }
    return a.y<b.y;
}

// adds this tracks results to each brains totals
function endTrack(){
    for(let i=0;i<cars.length;i++){
        const car=cars[i];
        if(car.finished){
            results[i].finishedTracks++;
        }
        results[i].totalScore+=car.score;
        results[i].ending+=car.x+","+car.y+","+car.angle+";";
    }
    if(track==1){
        trackProgress();
    }
    if(track<TRACK_COUNT){
        nextTrackDue=true;
    }else{
        endGeneration();
    }
}

// a car finishing the main track counts as progress too
function trackProgress(){
    const best=Math.max(...cars.map(c=>c.score));
    if(cars.some(c=>c.finished)||best>bestMainScore+MIN_IMPROVEMENT){
        bestMainScore=Math.max(bestMainScore,best);
        stuckGenerations=0;
    }else{
        stuckGenerations++;
    }
}

function endGeneration(){
    const ranked=rankBrains();
    const best=ranked[0];
    parents=pickParents(ranked);
    if(best.finishedTracks==TRACK_COUNT){
        winner=cars[brains.indexOf(best.brain)];
        bestCar=winner;
        save();
        localStorage.setItem("trained","true");
        const title=TRACK_COUNT==1
            ?"finished in "+formatTime(winner.finishFrame)
            :"finished all "+TRACK_COUNT+" tracks";
        showBanner("🏁 Generation "+generation+" "+title,
            "Training complete. Reload to watch the replay, "+
            "or press Reset to train again.");
        return;
    }
    let message=TRACK_COUNT==1
        ?"Generation "+generation+" done: passed "+
            bestCar.passed+"/"+traffic.length
        :"Generation "+generation+" done: best car finished "+
            best.finishedTracks+" of "+TRACK_COUNT+" tracks";
    if(stuckGenerations>=RESTART_AFTER){
        parents=[];
        bestMainScore=-Infinity;
        stuckGenerations=0;
        message="Stuck for "+RESTART_AFTER+
            " generations, so starting over with new cars";
    }
    save();
    showToast(message);
    nextTrackDue=true;
}

function drawStats(ctx){
    let status="Speed "+bestCar.speed.toFixed(1);
    if(bestCar.finished){
        status="Finished";
    }else if(bestCar.stalled){
        status="Stalled";
    }else if(bestCar.damaged){
        status="Crashed";
    }
    const clock=bestCar.finished
        ?"Finish "+formatTime(bestCar.finishFrame)
        :"Time "+formatTime(trackOver?endFrame:frame);
    const rows=[
        ["Generation "+generation,
            trained||winner?"Trained":"Alive "+aliveCount+"/"+N],
        ["Passed "+bestCar.passed+"/"+traffic.length,status],
        ["Distance "+Math.round(START_Y-bestCar.y),clock]
    ];
    if(TRACK_COUNT>1){
        rows.splice(1,0,["Track "+track+" of "+TRACK_COUNT,
            track==1?"Main":"Random"]);
    }
    const rowHeight=17;
    const barHeight=rows.length*rowHeight+10;
    const top=ctx.canvas.height-barHeight;
    ctx.fillStyle="rgba(0,0,0,0.6)";
    ctx.fillRect(0,top,ctx.canvas.width,barHeight);

    ctx.fillStyle="#eee";
    ctx.font="12px sans-serif";
    ctx.textBaseline="middle";
    for(let i=0;i<rows.length;i++){
        const y=top+14+i*rowHeight;
        ctx.textAlign="left";
        ctx.fillText(rows[i][0],8,y);
        ctx.textAlign="right";
        ctx.fillText(rows[i][1],ctx.canvas.width-8,y);
    }
}

function formatTime(steps){
    return (steps/STEPS_PER_SECOND).toFixed(1)+"s";
}

// checkered band across the road, centered on the followed car's finish line
function drawFinishLine(ctx){
    const finishY=bestCar.finishY;
    if(finishY===null){
        return;
    }
    const size=10;
    const cols=Math.round(road.width/size);
    const w=road.width/cols;
    for(let row=0;row<2;row++){
        for(let col=0;col<cols;col++){
            ctx.fillStyle=(row+col)%2==0?"white":"black";
            ctx.fillRect(road.left+col*w,finishY-size+row*size,w,size);
        }
    }
}

function animate(time){
    if(lastTime===null){
        lastTime=time;
    }
    pendingMs+=Math.min(time-lastTime,MAX_CATCHUP_MS)*speed;
    lastTime=time;
    while(pendingMs>=STEP_MS-STEP_TOLERANCE_MS){
        step();
        pendingMs-=STEP_MS;
    }
    draw(time);
    requestAnimationFrame(animate);
}

function step(){
    if(nextTrackDue){
        nextTrackDue=false;
        if(track==TRACK_COUNT){
            generation++;
            track=1;
        }else{
            track++;
        }
        startTrack();
    }
    frame++;
    // once a car wins, every car (traffic too) stops where it is
    if(!winner){
        for(let i=0;i<traffic.length;i++){
            traffic[i].update(road.borders,[]);
        }
        for(let i=0;i<cars.length;i++){
            if(!cars[i].finished){
                cars[i].update(road.borders,traffic);
            }
        }
        updateScores();
        bestCar=cars.reduce((best,c)=>isBetter(c,best)?c:best);
    }
    const aliveCars=cars.filter(c=>!c.damaged&&!c.finished);
    aliveCount=aliveCars.length;

    // a track is over once every car has crashed, stalled or finished
    if(!trackOver&&aliveCount==0){
        trackOver=true;
        endFrame=frame;
        if(!trained){
            endTrack();
        }else if(bestCar.finished){
            winner=bestCar;
            showBanner("🏁 Finished in "+formatTime(winner.finishFrame),
                "Replay of generation "+generation+
                ". Reload to watch again, or press Reset to train again.");
        }
    }
}

function draw(time){
    // the network canvas shares its column with the control bar
    const controlHeight=controlBar.offsetHeight;
    carCanvas.height=window.innerHeight;
    networkCanvas.height=window.innerHeight-controlHeight;

    carCtx.save();
    carCtx.translate(0,-bestCar.y+carCanvas.height*0.7);

    road.draw(carCtx);
    drawFinishLine(carCtx);
    for(let i=0;i<traffic.length;i++){
        traffic[i].draw(carCtx);
    }
    // Crashed cars fade into the background so the survivors stand out.
    carCtx.globalAlpha=0.05;
    for(let i=0;i<cars.length;i++){
        if(cars[i].damaged){
            cars[i].draw(carCtx);
        }
    }
    carCtx.globalAlpha=0.2;
    for(let i=0;i<cars.length;i++){
        if(!cars[i].damaged){
            cars[i].draw(carCtx);
        }
    }
    carCtx.globalAlpha=1;
    bestCar.draw(carCtx,true,hoveredInput);

    carCtx.restore();

    drawStats(carCtx);

    networkCtx.lineDashOffset=-time/50;
    Visualizer.drawNetwork(networkCtx,bestCar,hoveredInput);
}
