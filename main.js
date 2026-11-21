const carCanvas=document.getElementById("carCanvas");
carCanvas.width=200;
const networkCanvas=document.getElementById("networkCanvas");
networkCanvas.width=300;

const carCtx = carCanvas.getContext("2d");
const networkCtx = networkCanvas.getContext("2d");

const road=new Road(carCanvas.width/2,carCanvas.width*0.9);

const N=100;
const START_Y=100;

const FINISH_GAP=500;
let finishLineAnnounced=false;

// training stops when the first car finishes. its brain is kept, and after
// that the page just replays that winner driving until Reset is pressed
const trained=localStorage.getItem("trained")=="true"&&
    localStorage.getItem("bestBrain")!==null;
let winner=null;

const DEFAULT_MUTATION=0.2;
const mutation=loadMutation();

// sometimes cars will tailgate forever and never crash. 
// remove them if they get taken out
const STALL_FRAMES=180;

const AUTO_NEXT_DELAY=1200;

const cars=generateCars(trained?1:N);
let bestCar=cars[0];
let aliveCount=cars.length;
let frame=0;
let generationOver=false;
let endFrame=null;
let autoNextTimer=null;
let toastTimer=null;

// when trained, show the winner's generation instead of counting on
const savedGeneration=Number(localStorage.getItem("generation"))||1;
const generation=trained
    ?savedGeneration
    :localStorage.getItem("bestBrain")?savedGeneration+1:1;

if(localStorage.getItem("bestBrain")){
    for(let i=0;i<cars.length;i++){
        cars[i].brain=JSON.parse(
            localStorage.getItem("bestBrain"));
        if(i!=0){
            NeuralNetwork.mutate(cars[i].brain,mutation);
        }
    }
}

const traffic=[
    new Car(road.getLaneCenter(1),-100,30,50,"DUMMY",2,getRandomColor()),
    new Car(road.getLaneCenter(0),-300,30,50,"DUMMY",2,getRandomColor()),
    new Car(road.getLaneCenter(2),-300,30,50,"DUMMY",2,getRandomColor()),
    new Car(road.getLaneCenter(0),-500,30,50,"DUMMY",2,getRandomColor()),
    new Car(road.getLaneCenter(1),-500,30,50,"DUMMY",2,getRandomColor()),
    new Car(road.getLaneCenter(1),-700,30,50,"DUMMY",2,getRandomColor()),
    new Car(road.getLaneCenter(2),-700,30,50,"DUMMY",2,getRandomColor()),
];
// All traffic drives at the same speed, so the first car tracks how far
// the whole pack has moved.
const trafficStartY=traffic[0].y;

const controlBar=document.getElementById("controlBar");
const mutationSlider=document.getElementById("mutationSlider");
const mutationValue=document.getElementById("mutationValue");
mutationSlider.value=mutation;
mutationValue.textContent=mutation.toFixed(2);
mutationSlider.addEventListener("input",()=>{
    const value=Number(mutationSlider.value);
    mutationValue.textContent=value.toFixed(2);
    localStorage.setItem("mutation",value);
});
// the current cars were already mutated when the page loaded
mutationSlider.addEventListener("change",()=>{
    const when=trained||winner?"after a reset":"from the next generation";
    showToast("Mutation "+Number(mutationSlider.value).toFixed(2)+
        " applies "+when);
});

animate();

function loadMutation(){
    const stored=localStorage.getItem("mutation");
    const value=stored===null?NaN:Number(stored);
    if(Number.isFinite(value)&&value>=0&&value<=1){
        return value;
    }
    return DEFAULT_MUTATION;
}

function save(){
    localStorage.setItem("bestBrain",
        JSON.stringify(bestCar.brain));
    localStorage.setItem("generation",generation);
}

function saveAndRestart(){
    save();
    location.reload();
}

// the mutation setting is kept
function resetTraining(){
    if(!confirm("Discard the saved brain and start training again from random cars?")){
        return;
    }
    clearTimeout(autoNextTimer);
    localStorage.removeItem("bestBrain");
    localStorage.removeItem("generation");
    localStorage.removeItem("trained");
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
        :"Time "+formatTime(generationOver?endFrame:frame);
    const rows=[
        ["Generation "+generation,
            trained||winner?"Trained":"Alive "+aliveCount+"/"+N],
        ["Passed "+bestCar.passed+"/"+traffic.length,status],
        ["Distance "+Math.round(START_Y-bestCar.y),clock]
    ];
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

// game time, counted in frames so it's the same at any refresh rate
function formatTime(frames){
    return (frames/60).toFixed(1)+"s";
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

    if(!generationOver){
        if(bestCar.finished){
            // the first car over the line wins and training stops
            generationOver=true;
            endFrame=frame;
            winner=bestCar;
            const time=formatTime(winner.finishFrame);
            if(trained){
                showBanner("🏁 Finished in "+time,
                    "Replay of generation "+generation+
                    ". Reload to watch again, or press Reset to train again.");
            }else{
                save();
                localStorage.setItem("trained","true");
                showBanner("🏁 Generation "+generation+" finished in "+time,
                    "Training complete. Reload to watch the replay, "+
                    "or press Reset to train again.");
            }
        }else if(aliveCount==0){
            // every car crashed or stalled: keep the best brain and go again
            generationOver=true;
            endFrame=frame;
            if(!trained){
                showToast("Generation "+generation+" done: passed "+
                    bestCar.passed+"/"+traffic.length+". Starting the next one…");
                autoNextTimer=setTimeout(saveAndRestart,AUTO_NEXT_DELAY);
            }
        }
    }

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
    bestCar.draw(carCtx,true);

    carCtx.restore();

    drawStats(carCtx);

    networkCtx.lineDashOffset=-time/50;
    Visualizer.drawNetwork(networkCtx,bestCar.brain);
    requestAnimationFrame(animate);
}
