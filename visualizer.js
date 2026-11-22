class Visualizer{
    static #SENSOR_AREA=160;
    static #MIN_SIGNAL=0.05;
    static #inputSpots=[];
    static #CONTROLS=[
        {name:"forward",angle:0},
        {name:"left",angle:-Math.PI/2},
        {name:"right",angle:Math.PI/2},
        {name:"reverse",angle:Math.PI}
    ];

    static drawNetwork(ctx,car,focus=null){
        const network=car.brain;
        const margin=50;
        const left=margin;
        const top=margin;
        const width=ctx.canvas.width-margin*2;
        const height=ctx.canvas.height-Visualizer.#SENSOR_AREA-top;
        const nodeRadius=18;

        const levelHeight=height/network.levels.length;

        for(let i=network.levels.length-1;i>=0;i--){
            const levelTop=top+
                lerp(
                    height-levelHeight,
                    0,
                    network.levels.length==1
                        ?0.5
                        :i/(network.levels.length-1)
                );

            Visualizer.#drawLevel(ctx,network.levels[i],
                left,levelTop,
                width,levelHeight,
                nodeRadius,
                i==network.levels.length-1
                    ?Visualizer.#CONTROLS
                    :[],
                i==0?focus:null
            );
        }

        const inputRowY=top+height;
        Visualizer.#drawSensors(ctx,car,left,inputRowY,width,nodeRadius,focus);
        Visualizer.#drawCaption(ctx,car,inputRowY,focus);
    }

    // the input whose node, sensor ray or speed gauge is at x,y, or null
    static inputAt(x,y){
        let found=null;
        let closest=Infinity;
        for(const spot of Visualizer.#inputSpots){
            const distance=Visualizer.#distanceToSegment(x,y,spot.from,spot.to)-
                spot.reach;
            if(distance<=0&&distance<closest){
                closest=distance;
                found=spot.index;
            }
        }
        return found;
    }

    static #drawLevel(ctx,level,left,top,width,height,nodeRadius,controls,focus){
        const right=left+width;
        const bottom=top+height;

        const {inputs,outputs,weights,biases}=level;

        // the focused input's connections go on top and the rest fade out
        const order=[];
        for(let i=0;i<inputs.length;i++){
            if(i!==focus){
                order.push(i);
            }
        }
        if(focus!==null&&focus<inputs.length){
            order.push(focus);
        }
        const connect=(i,j)=>{
            ctx.beginPath();
            ctx.moveTo(
                Visualizer.#getNodeX(inputs,i,left,right),
                bottom
            );
            ctx.lineTo(
                Visualizer.#getNodeX(outputs,j,left,right),
                top
            );
        };

        ctx.setLineDash([]);
        ctx.lineWidth=1;
        for(const i of order){
            ctx.globalAlpha=focus===null||i===focus?1:0.1;
            for(let j=0;j<outputs.length;j++){
                connect(i,j);
                ctx.strokeStyle=getRGBA(
                    clamp(weights[i][j],-1,1)*(i===focus?0.5:0.2));
                ctx.stroke();
            }
        }

        ctx.setLineDash([7,3]);
        for(const i of order){
            ctx.globalAlpha=focus===null||i===focus?1:0.1;
            for(let j=0;j<outputs.length;j++){
                const signal=(inputs[i]??0)*weights[i][j];
                if(Math.abs(signal)<Visualizer.#MIN_SIGNAL){
                    continue;
                }
                connect(i,j);
                ctx.lineWidth=1+2*Math.min(1,Math.abs(signal));
                ctx.strokeStyle=getRGBA(signal);
                ctx.stroke();
            }
        }
        ctx.globalAlpha=1;
        ctx.setLineDash([]);

        for(let i=0;i<inputs.length;i++){
            const x=Visualizer.#getNodeX(inputs,i,left,right);
            ctx.beginPath();
            ctx.arc(x,bottom,nodeRadius,0,Math.PI*2);
            ctx.fillStyle="black";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x,bottom,nodeRadius*0.6,0,Math.PI*2);
            ctx.fillStyle=getRGBA(inputs[i]??0);
            ctx.fill();

            // an outline so an input reading 0 still shows where it is
            ctx.beginPath();
            if(i===focus){
                ctx.arc(x,bottom,nodeRadius+3,0,Math.PI*2);
                ctx.lineWidth=2;
                ctx.strokeStyle="white";
            }else{
                ctx.arc(x,bottom,nodeRadius,0,Math.PI*2);
                ctx.lineWidth=1.5;
                ctx.strokeStyle="#444";
            }
            ctx.stroke();
        }

        for(let i=0;i<outputs.length;i++){
            const x=Visualizer.#getNodeX(outputs,i,left,right);
            ctx.beginPath();
            ctx.arc(x,top,nodeRadius,0,Math.PI*2);
            ctx.fillStyle="black";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x,top,nodeRadius*0.6,0,Math.PI*2);
            ctx.fillStyle=getRGBA(outputs[i]??0);
            ctx.fill();

            ctx.beginPath();
            ctx.lineWidth=2;
            ctx.arc(x,top,nodeRadius*0.8,0,Math.PI*2);
            ctx.strokeStyle=getRGBA(biases[i]);
            ctx.setLineDash([3,3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // a dark arrow on the lit node while the car is pressing this
            // control, a gray one when it isn't
            if(controls[i]){
                const pressed=outputs[i]>0;
                Visualizer.#drawArrow(ctx,x,top,controls[i].angle,
                    pressed?"black":"#777");
                ctx.font="11px sans-serif";
                ctx.textAlign="center";
                ctx.textBaseline="alphabetic";
                ctx.fillStyle=pressed?"#eee":"#666";
                ctx.fillText(controls[i].name,x,top-nodeRadius-8);
            }
        }
    }

    // an arrow centered on x,y that points up, turned clockwise by angle
    static #drawArrow(ctx,x,y,angle,color){
        ctx.save();
        ctx.translate(x,y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0,7);
        ctx.lineTo(0,-7);
        ctx.moveTo(-5.5,-1.5);
        ctx.lineTo(0,-7);
        ctx.lineTo(5.5,-1.5);
        ctx.lineWidth=3;
        ctx.lineCap="round";
        ctx.lineJoin="round";
        ctx.strokeStyle=color;
        ctx.stroke();
        ctx.restore();
    }

    static #drawSensors(ctx,car,left,rowY,width,nodeRadius,focus){
        const inputs=car.brain.levels[0].inputs;
        const sensor=car.sensor;
        const rayCount=sensor.rayCount;
        const nodeX=i=>Visualizer.#getNodeX(inputs,i,left,left+width);
        const spots=[];
        for(let i=0;i<inputs.length;i++){
            const node={x:nodeX(i),y:rowY};
            spots.push({index:i,from:node,to:node,reach:nodeRadius+4});
        }

        const carX=(nodeX(0)+nodeX(rayCount-1))/2;
        const halfSpan=(nodeX(rayCount-1)-nodeX(0))/2;
        const fan=Math.tan(sensor.raySpread/2);
        const carY=rowY+(fan>0?clamp(halfSpan/fan,50,80):80);
        const carWidth=18;
        const carHeight=30;

        for(let i=0;i<rayCount;i++){
            const node={x:nodeX(i),y:rowY};
            const length=Math.hypot(node.x-carX,node.y-carY);
            const along=distance=>({
                x:lerp(carX,node.x,distance/length),
                y:lerp(carY,node.y,distance/length)
            });
            // from the car's nose to the edge of the node
            const from=along(carHeight/2-1);
            const to=along(length-nodeRadius);
            spots.push({index:i,from,to,reach:6});

            const value=inputs[i]??0;
            const touch={
                x:lerp(from.x,to.x,1-value),
                y:lerp(from.y,to.y,1-value)
            };
            ctx.globalAlpha=focus===null||focus===i?1:0.3;
            ctx.lineWidth=focus===i?3:2;
            Visualizer.#line(ctx,from,touch,"yellow");
            if(value>0){
                Visualizer.#line(ctx,touch,to,"#555");
                ctx.beginPath();
                ctx.arc(touch.x,touch.y,2.5,0,Math.PI*2);
                ctx.fillStyle="white";
                ctx.fill();
            }
        }
        ctx.globalAlpha=1;
        car.drawBody(ctx,carX,carY,carWidth,carHeight);

        // the input after the rays is the car's speed
        if(inputs.length>rayCount){
            const gauge={x:nodeX(rayCount),y:rowY+58};
            spots.push({index:rayCount,from:gauge,to:gauge,reach:20});
            ctx.globalAlpha=focus===null||focus===rayCount?1:0.3;
            Visualizer.#drawSpeedGauge(ctx,gauge,inputs[rayCount]??0,
                rowY+nodeRadius);
            ctx.globalAlpha=1;
        }
        Visualizer.#inputSpots=spots;
    }

    static #drawSpeedGauge(ctx,center,value,nodeBottom){
        const radius=14;
        const start=Math.PI*0.75;
        const sweep=Math.PI*1.5;
        const angleOf=v=>start+sweep*(clamp(v,-0.5,1)+0.5)/1.5;

        ctx.lineWidth=2;
        Visualizer.#line(ctx,
            {x:center.x,y:center.y-radius-4},
            {x:center.x,y:nodeBottom},
            "#555");

        ctx.lineWidth=4;
        ctx.beginPath();
        ctx.arc(center.x,center.y,radius,start,start+sweep);
        ctx.strokeStyle="#333";
        ctx.stroke();
        if(value!=0){
            const zero=angleOf(0);
            const now=angleOf(value);
            ctx.beginPath();
            ctx.arc(center.x,center.y,radius,Math.min(zero,now),Math.max(zero,now));
            ctx.strokeStyle=getRGBA(Math.sign(value));
            ctx.stroke();
        }

        const needle=angleOf(value);
        ctx.lineWidth=2;
        Visualizer.#line(ctx,center,{
            x:center.x+Math.cos(needle)*(radius-3),
            y:center.y+Math.sin(needle)*(radius-3)
        },"white");
        ctx.beginPath();
        ctx.arc(center.x,center.y,2.5,0,Math.PI*2);
        ctx.fillStyle="white";
        ctx.fill();

        ctx.font="10px sans-serif";
        ctx.textAlign="center";
        ctx.textBaseline="alphabetic";
        ctx.fillStyle="#888";
        ctx.fillText("speed",center.x,center.y+radius+11);
    }

    // what the focused input measures, under the sensor diagram
    static #drawCaption(ctx,car,rowY,focus){
        const x=ctx.canvas.width/2;
        ctx.textAlign="center";
        ctx.textBaseline="alphabetic";
        if(focus===null){
            ctx.font="12px sans-serif";
            ctx.fillStyle="#888";
            ctx.fillText("Hover a sensor to see what it reads",x,rowY+128);
            return;
        }
        const {title,detail,hint}=car.describeInput(focus);
        ctx.font="bold 13px sans-serif";
        ctx.fillStyle="#eee";
        ctx.fillText(title,x,rowY+118);
        ctx.font="12px sans-serif";
        ctx.fillStyle="#ccc";
        ctx.fillText(detail,x,rowY+135);
        ctx.font="11px sans-serif";
        ctx.fillStyle="#888";
        ctx.fillText(hint,x,rowY+151);
    }

    static #line(ctx,from,to,color){
        ctx.beginPath();
        ctx.moveTo(from.x,from.y);
        ctx.lineTo(to.x,to.y);
        ctx.strokeStyle=color;
        ctx.stroke();
    }

    static #distanceToSegment(x,y,from,to){
        const dx=to.x-from.x;
        const dy=to.y-from.y;
        const lengthSquared=dx*dx+dy*dy;
        const t=lengthSquared==0
            ?0
            :clamp(((x-from.x)*dx+(y-from.y)*dy)/lengthSquared,0,1);
        return Math.hypot(x-(from.x+dx*t),y-(from.y+dy*t));
    }

    static #getNodeX(nodes,index,left,right){
        return lerp(
            left,
            right,
            nodes.length==1
                ?0.5
                :index/(nodes.length-1)
        );
    }
}
