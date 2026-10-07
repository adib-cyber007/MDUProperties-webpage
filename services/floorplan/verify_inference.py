"""Real-checkpoint regression with added measurement rails outside a real plan.

This checks a known annotation region, not general recognition accuracy. It also
runs supplied reference images and writes diagnostic results without saving a
project or publishing a model.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from mitunet_pipeline import MitUNetPipeline
from pipeline import write_artifacts

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'work'/'mitunet-verification'


def verify(files):
    WORK.mkdir(parents=True,exist_ok=True)
    model=MitUNetPipeline()
    reports=[]
    for index,file in enumerate(files):
        image=Image.open(file).convert('RGB')
        wall_only,_,_=model.predict(image,30,40,mode='walls')
        result,rooms,icons=model.predict(image,30,40)
        structural=[w for w in result['walls'] if w['kind']=='wall']
        assert structural==wall_only['walls'],'auxiliary predictions changed MitUNet walls'
        assert result['candidates']==wall_only['candidates']
        if index==0:
            assert all(any(w['kind']==kind for w in result['walls']) for kind in ['door','window'])
            assert result['furniture'] and result['rooms']
        assert all(0<=p<=1 for wall in result['walls'] for key in ['a','b'] for p in wall[key])
        write_artifacts(WORK/f'reference-{index+1}',result,rooms,icons)
        reports.append({'file':str(file),'walls':len(structural),
                        'doors':sum(w['kind']=='door' for w in result['walls']),
                        'windows':sum(w['kind']=='window' for w in result['walls']),
                        'fixtures':len(result['furniture']),'rooms':len(result['rooms']),
                        'primaryWallsUnchanged':True,'candidates':len(result['candidates']),
                        'annotations':result['summary'],'inferenceMs':result['inferenceMs']})

    original=Image.open(files[0]).convert('RGB')
    width,height=original.size
    canvas=Image.new('RGB',(width+260,height+240),'white')
    left,top=160,180
    canvas.paste(original,(left,top))
    draw=ImageDraw.Draw(canvas)
    # Numeric labels, extension strokes and tick marks accompany both rails.
    x0,x1=left+width*.2,left+width*.8
    y=85
    draw.line((x0,y,x1,y),fill='black',width=2)
    for x in [x0,x1]:
        draw.line((x,y-30,x,y+35),fill='black',width=2)
        draw.line((x-8,y+8,x+8,y-8),fill='black',width=2)
    try:font=ImageFont.truetype('DejaVuSans.ttf',28)
    except OSError:
        try:font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',28)
        except OSError:font=ImageFont.load_default(size=28)
    draw.text(((x0+x1)/2-50,y-35),'6000',fill='black',font=font)
    x=65;y0,y1=top+height*.1,top+height*.9
    draw.line((x,y0,x,y1),fill='black',width=2)
    for yy in [y0,y1]:draw.line((x-25,yy,x+30,yy),fill='black',width=2)
    draw.text((8,(y0+y1)/2-14),'4000',fill='black',font=font)
    path=WORK/'measurement-regression.png';canvas.save(path)
    result,rooms,icons=model.predict(canvas,30,40)
    write_artifacts(WORK/'measurement-regression',result,rooms,icons)
    assert result['summary']['dimensionLines']>=2,'OCR-anchored measurement rails were not detected'
    # Both rail locations are outside the pasted source drawing. No accepted
    # wall midpoint may occupy either known measurement band.
    wrong=[]
    for wall in result['walls']:
        mx=(wall['a'][0]+wall['b'][0])/2*canvas.width
        my=(wall['a'][1]+wall['b'][1])/2*canvas.height
        if my<top-20 or mx<left-20:wrong.append(wall)
    assert not wrong,f'{len(wrong)} measurement-region fragments entered 3D walls'
    retained=sum(w['kind']=='wall' for w in result['walls'])
    assert retained>=8,'filtering discarded the real structural plan'
    report={'pass':True,'engine':'mitunet','pipeline':'combined','accuracyBenchmark':False,'references':reports,
            'measurementRegression':{'dimensionLines':result['summary']['dimensionLines'],
              'acceptedSegmentsInKnownMeasurementRegions':len(wrong),'retainedWallSegments':retained,
              'inferenceMs':result['inferenceMs']}}
    (WORK/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':
    files=[Path(file) for file in sys.argv[1:]] or [ROOT/'work'/f'reference-floorplan{suffix}.png' for suffix in ['', '-2','-3']]
    verify(files)
