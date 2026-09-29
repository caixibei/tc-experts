const h='a'.repeat(64);
export const rc27Actions={
  auditProject:{required:['root','fromCheckpoint:true or explicit project bindings','delivery:{directory,expectedManifestDigest}'],optional:['purpose:working_draft|factual_acceptance'],example:{root:'/authorized/project',fromCheckpoint:true,delivery:{directory:'deliveries/'+h,expectedManifestDigest:h},purpose:'working_draft'}},
  sourceSelectors:{required:['text','selectors:[{id,exact,prefix?,suffix?}]'],example:{text:'前言。原文可能到年底完成。后记。',selectors:[{id:'fact',exact:'原文可能到年底完成。'}]}},
  reviewBindings:{required:['subjects:[{chapterId,textDigest,basisDigest}]','reviews:[{id,chapterId,actorType,decision,reviewedTextDigest,basisDigest}]'],example:{subjects:[{chapterId:'chapter-1',textDigest:h,basisDigest:h}],reviews:[]}},
  deriveSource:{required:['root','sourcePath','expectedDigest','kind:simulation|proposed_correction','basisRef','patches'],example:{root:'/authorized/project',sourcePath:'source.txt',expectedDigest:h,kind:'simulation',basisRef:'test-plan:date-change',patches:[{start:0,end:4,expected:'2015',replacement:'2016'}]}},
  verifyDelivery:{required:['root','directory:deliveries/<id>','expectedManifestDigest'],example:{root:'/authorized/project',directory:'deliveries/'+h,expectedManifestDigest:h}},
  preparePreview:{required:['root','directory:deliveries/<id>','expectedManifestDigest'],example:{root:'/authorized/project',directory:'deliveries/'+h,expectedManifestDigest:h},boundary:'creates a separate preview copy; canonical bytes remain exact and must be verified after preview'}
};
