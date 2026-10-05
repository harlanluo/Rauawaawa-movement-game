import { openVideo, sampleTimes, targetSize, withTimeout } from '../video_style/media.js';
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export function referenceFeatures(pose, mode, aspect) {
    const seated = mode === 'seated';
    const indices = seated ? [11,12,13,14,15,16] : [11,12,13,14,15,16,23,24,25,26,27,28];
    const anchors = seated ? [11,12] : [11,12,23,24];
    if (!pose || pose.length !== 33 || anchors.some(i => pose[i].visibility < .5)) return null;
    if (pose.some(p => !['x','y','z','visibility'].every(key => Number.isFinite(p[key])))) return null;
    const quality = indices.reduce((sum, i) => sum + pose[i].visibility, 0) / indices.length;
    const minimum = seated ? 4 : 8;
    if (quality < .7 || indices.filter(i => pose[i].visibility >= .5).length < minimum) return null;
    const midpoint = (a,b) => [(pose[a].x + pose[b].x) * aspect / 2, (pose[a].y + pose[b].y) / 2];
    const shoulders = midpoint(11,12), center = seated ? shoulders : midpoint(23,24);
    const scale = seated ? Math.hypot((pose[11].x-pose[12].x)*aspect,pose[11].y-pose[12].y)
        : Math.hypot(shoulders[0]-center[0],shoulders[1]-center[1]);
    if (scale < .03) return null;
    return { pose, quality, center, scale, minimum,
        points: indices.map(i => [(pose[i].x*aspect-center[0])/scale, (pose[i].y-center[1])/scale,pose[i].visibility]) };
}
export function referenceDistance(a,b) {
    let sum=0, weight=0, count=0;
    a.points.forEach((p,i) => {
        const q=b.points[i], w=Math.min(p[2],q[2]);
        if(w >= .5) { sum+=w*((p[0]-q[0])**2+(p[1]-q[1])**2);weight+=w;count++; }
    });
    return count >= a.minimum ? Math.sqrt(sum/weight) : Infinity;
}
export function selectReference(candidates, previous, elapsedMs, mode, aspect) {
    const ranked = candidates.map(p => referenceFeatures(p,mode,aspect)).filter(Boolean).map(feature => {
        const distance = previous ? referenceDistance(previous,feature) : 0;
        const limit = Math.min(1.1,.65+2*elapsedMs/1000);
        const position = previous ? Math.hypot(feature.center[0]-previous.center[0],feature.center[1]-previous.center[1])/previous.scale : Math.abs(feature.center[0]/aspect-.5);
        return {feature,distance,cost:1-feature.quality+.25*distance+.025*position,valid:!previous || distance<=limit};
    }).filter(item=>item.valid).sort((a,b)=>a.cost-b.cost || a.feature.center[0]-b.feature.center[0]);
    if(ranked.length>1 && ranked[1].cost-ranked[0].cost<.04 && referenceDistance(ranked[0].feature,ranked[1].feature)>.9) return null;
    return ranked[0]?.feature || null;
}

export async function extractBrowserReference(file, { mode='standing', signal, onProgress=()=>{} }={}) {
    const check=()=>{if(signal?.aborted) throw new DOMException('Cancelled','AbortError');};
    let video=null, model=null, iterator=null;
    try {
        onProgress('Loading movement model…');
        const {FilesetResolver,PoseLandmarker}=await import(VISION);
        check();
        const files=await FilesetResolver.forVisionTasks(WASM);
        check();
        model=await PoseLandmarker.createFromOptions(files,{
            baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},runningMode:'VIDEO',numPoses:4,
            minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5
        });
        check(); video=await openVideo(file); check();
        const times=sampleTimes(video.duration,10), {width,height}=targetSize(video.sourceWidth,video.sourceHeight);
        iterator=new video.mb.CanvasSink(video.videoTrack,{width,height,fit:'fill',poolSize:2})
            .canvasesAtTimestamps(times)[Symbol.asyncIterator]();
        const frames=[];
        let previous=null, previousTime=0;
        for(let index=0;index<times.length;index++) {
            check();
            const step=await withTimeout(iterator.next(),20000,'decoding movement frame'); check();
            if(step.done) throw new Error('Incomplete video decode');
            const timeMs=Math.round(times[index]*1000);
            const candidates=step.value ? model.detectForVideo(step.value.canvas,timeMs).landmarks : [];
            const selected=selectReference(candidates,previous,timeMs-previousTime,mode,width/height);
            frames.push({timeMs,landmarks:selected?.pose || null});
            if(selected) { previous=selected;previousTime=timeMs; }
            onProgress(`Extracting movement ${index+1} / ${times.length}…`);
            await new Promise(resolve=>setTimeout(resolve,0));
        }
        check();
        if(!frames.some(frame=>frame.landmarks)) throw new Error(mode==='seated'
            ? 'Keep both shoulders and arms visible in this clip.' : 'Keep your shoulders, hips and limbs visible in this clip.');
        return {formatVersion:1,sourceVideo:'uploaded-original-video',
            video:{width:video.sourceWidth,height:video.sourceHeight,durationMs:Math.min(video.duration,60)*1000},
            sampling:{targetFps:10,decoder:'Mediabunny/WebCodecs'},
            poseModel:{profile:'Full float16',url:MODEL,numPoses:4},
            subjectTracking:{strategy:'browser-greedy-normalized-continuity-v1',bodyMode:mode},frames};
    } finally {
        iterator?.return?.().catch(()=>{}); model?.close(); video?.input.dispose();
    }
}
