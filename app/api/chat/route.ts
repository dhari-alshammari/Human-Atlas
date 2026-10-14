import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI service is not configured' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const symptoms = String(body.symptoms || '').trim();
    const bodyPart = String(body.bodyPart || '').trim();
    const language = body.language === 'en' ? 'en' : 'ar';

    if (!symptoms || symptoms.length > 2000) {
      return NextResponse.json(
        { error: 'Please provide symptoms (maximum 2000 characters)' },
        { status: 400 }
      );
    }

    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are Your Smart Doctor, a cautious health information assistant. Respond in ${language === 'ar' ? 'Arabic' : 'English'}. Ask relevant follow-up questions when information is insufficient. Explain possible causes without claiming a definitive diagnosis. The selected anatomical structure indicates location only, not necessarily the cause. Identify emergency warning signs and recommend urgent care when appropriate. Never prescribe medication doses or advise stopping prescribed treatments. Keep responses clear and empathetic.`,
            },
            {
              role: 'user',
              content: `Selected body area: ${bodyPart || 'Not specified'}\nSymptoms: ${symptoms}`,
            },
          ],
          temperature: 0.3,
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'AI service request failed' },
        { status: 502 }
      );
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content;

    if (!answer) {
      return NextResponse.json(
        { error: 'No response generated' },
        { status: 502 }
      );
    }

    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json(
      { error: 'Unable to process request' },
      { status: 500 }
    );
  }
}
