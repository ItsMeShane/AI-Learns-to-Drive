class Car{
    constructor(x,y,width,height,controlType,maxSpeed=3,color="blue"){
        this.x=x;
        this.y=y;
        this.width=width;
        this.height=height;

        this.speed=0;
        this.acceleration=0.2;
        this.maxSpeed=maxSpeed;
        this.friction=0.05;
        this.angle=0;
        this.damaged=false;

        this.useBrain=controlType=="AI";

        if(controlType!="DUMMY"){
            this.sensor=new Sensor(this);
            // one input per sensor ray, plus the car's own speed
            this.brain=new NeuralNetwork(
                [this.sensor.rayCount+1,6,4]
            );
        }
        this.controls=new Controls(controlType);

        this.img=new Image();
        this.img.src="car.png"

        this.mask=document.createElement("canvas");
        this.mask.width=width;
        this.mask.height=height;

        const maskCtx=this.mask.getContext("2d");
        this.img.onload=()=>{
            maskCtx.fillStyle=color;
            maskCtx.rect(0,0,this.width,this.height);
            maskCtx.fill();

            maskCtx.globalCompositeOperation="destination-atop";
            maskCtx.drawImage(this.img,0,0,this.width,this.height);
        }
    }

    update(roadBorders,traffic){
        const wasDamaged=this.damaged;
        if(!this.damaged){
            this.#move();
            this.polygon=this.#createPolygon();
            this.damaged=this.#assessDamage(roadBorders,traffic);
        }
        if(this.sensor&&!wasDamaged){
            this.sensor.update(roadBorders,traffic);
            const offsets=this.sensor.readings.map(
                s=>s==null?0:1-s.offset
            );
            // without its speed the brain can't tell whether it needs to brake
            const inputs=[...offsets,this.speed/this.maxSpeed];
            const outputs=NeuralNetwork.feedForward(inputs,this.brain);

            if(this.useBrain){
                this.controls.forward=outputs[0];
                this.controls.left=outputs[1];
                this.controls.right=outputs[2];
                this.controls.reverse=outputs[3];
            }
        }
    }

    #assessDamage(roadBorders,traffic){
        for(let i=0;i<roadBorders.length;i++){
            if(polysIntersect(this.polygon,roadBorders[i])){
                return true;
            }
        }
        for(let i=0;i<traffic.length;i++){
            if(polysIntersect(this.polygon,traffic[i].polygon)){
                return true;
            }
        }
        return false;
    }

    #createPolygon(){
        const points=[];
        const rad=Math.hypot(this.width,this.height)/2;
        const alpha=Math.atan2(this.width,this.height);
        points.push({
            x:this.x-Math.sin(this.angle-alpha)*rad,
            y:this.y-Math.cos(this.angle-alpha)*rad
        });
        points.push({
            x:this.x-Math.sin(this.angle+alpha)*rad,
            y:this.y-Math.cos(this.angle+alpha)*rad
        });
        points.push({
            x:this.x-Math.sin(Math.PI+this.angle-alpha)*rad,
            y:this.y-Math.cos(Math.PI+this.angle-alpha)*rad
        });
        points.push({
            x:this.x-Math.sin(Math.PI+this.angle+alpha)*rad,
            y:this.y-Math.cos(Math.PI+this.angle+alpha)*rad
        });
        return points;
    }

    #move(){
        if(this.controls.forward){
            this.speed+=this.acceleration;
        }
        if(this.controls.reverse){
            this.speed-=this.acceleration;
        }

        if(this.speed>this.maxSpeed){
            this.speed=this.maxSpeed;
        }
        if(this.speed<-this.maxSpeed/2){
            this.speed=-this.maxSpeed/2;
        }

        if(this.speed>0){
            this.speed-=this.friction;
        }
        if(this.speed<0){
            this.speed+=this.friction;
        }
        if(Math.abs(this.speed)<this.friction){
            this.speed=0;
        }

        if(this.speed!=0){
            const flip=this.speed>0?1:-1;
            if(this.controls.left){
                this.angle+=0.03*flip;
            }
            if(this.controls.right){
                this.angle-=0.03*flip;
            }
        }

        this.x-=Math.sin(this.angle)*this.speed;
        this.y-=Math.cos(this.angle)*this.speed;
    }

    draw(ctx,drawSensor=false,focusInput=null){
        if(this.sensor && drawSensor){
            const ray=focusInput!==null&&focusInput<this.sensor.rayCount
                ?focusInput
                :null;
            this.sensor.draw(ctx,ray);
        }

        ctx.save();
        ctx.translate(this.x,this.y);
        ctx.rotate(-this.angle);
        this.drawBody(ctx,0,0,this.width,this.height);
        ctx.restore();
    }

    drawBody(ctx,x,y,width,height){
        if(!this.damaged){
            ctx.drawImage(this.mask,
                x-width/2,
                y-height/2,
                width,
                height);
            ctx.globalCompositeOperation="multiply";
        }
        ctx.drawImage(this.img,
            x-width/2,
            y-height/2,
            width,
            height);
        ctx.globalCompositeOperation="source-over";
    }

    describeInput(i){
        const value=this.brain.levels[0].inputs[i]??0;
        const sent="  →  "+value.toFixed(2);
        if(i<this.sensor.rayCount){
            const angle=this.sensor.getRayAngle(i);
            const degrees=Math.round(Math.abs(angle)*180/Math.PI);
            const direction=degrees==0
                ?"straight ahead"
                :degrees+"° "+(angle>0?"left":"right");
            const reading=this.sensor.readings[i];
            const seen=reading
                ?(reading.type=="car"?"Car ":"Road edge ")+
                    Math.round(reading.offset*this.sensor.rayLength)+"px away"
                :"Nothing within "+this.sensor.rayLength+"px";
            return {
                title:"Sensor ray, "+direction,
                detail:seen+sent,
                hint:"1 = touching it, 0 = nothing in range"
            };
        }
        let detail="Stopped";
        if(this.speed>0){
            detail=this.speed.toFixed(1)+" of "+this.maxSpeed.toFixed(1)+" max";
        }else if(this.speed<0){
            detail="Reversing at "+(-this.speed).toFixed(1);
        }
        return {
            title:"Speed",
            detail:detail+sent,
            hint:"1 = top speed, below 0 = reversing"
        };
    }
}