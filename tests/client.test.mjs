import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailDraft } from '../src/main.js';

test('email draft preserves a message without injecting URL parameters', () => {
  const draft = createEmailDraft({name:'Jane & Co',email:'jane@example.com',subject:'R&D? next=1',message:'Hello\nA + B & C'});
  const url = new URL(draft);
  assert.equal(url.pathname,'BD@arvivatherap.com');
  assert.equal(url.searchParams.get('subject'),'R&D? next=1');
  assert.equal(url.searchParams.get('body'),'Name: Jane & Co\nEmail: jane@example.com\n\nHello\nA + B & C');
  assert.equal([...url.searchParams].length,2);
});
test('blank values and malformed emails never create an email draft', () => {
  const valid={name:'Jane',email:'jane@example.com',subject:'Hello',message:'Message'};
  for(const key of Object.keys(valid)) assert.throws(()=>createEmailDraft({...valid,[key]:'  '}));
  assert.throws(()=>createEmailDraft({...valid,email:'broken@'}));
  assert.throws(()=>createEmailDraft({...valid,email:'jane@example.com\nBcc:evil@example.com'}));
});
